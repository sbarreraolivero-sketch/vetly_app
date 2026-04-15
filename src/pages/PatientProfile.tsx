import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
    Dog,
    Syringe, ShieldAlert, FileText,
    Plus, Edit2, Trash2, Heart,
    Activity, ClipboardList, Save, X, Bell
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Patient, Tutor, ClinicalRecord } from '@/types/database'
import { cn } from '@/lib/utils'

import { MedicalEventForm, MedicalHistoryEvent } from '@/components/patients/MedicalEventForm'
import { VaccineForm, VaccineEvent } from '@/components/patients/VaccineForm'
import { DewormingForm, DewormingEvent } from '@/components/patients/DewormingForm'
import { PatientFiles } from '@/components/patients/PatientFiles'
import { PatientReminders } from '@/components/patients/PatientReminders'

export default function PatientProfile() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    
    const [loading, setLoading] = useState(true)
    const [patient, setPatient] = useState<Patient | null>(null)
    const [tutor, setTutor] = useState<Tutor | null>(null)
    const [clinicalInfo, setClinicalInfo] = useState<ClinicalRecord | null>(null)
    const [activeTab, setActiveTab] = useState<'history' | 'medical' | 'vaccines' | 'deworming' | 'files' | 'reminders'>('history')
    
    // Records state (Timeline)
    const [historyEvents, setHistoryEvents] = useState<MedicalHistoryEvent[]>([])
    const [showEventForm, setShowEventForm] = useState(false)
    const [editingEvent, setEditingEvent] = useState<MedicalHistoryEvent | null>(null)

    // Vaccines & Deworming state
    const [vaccines, setVaccines] = useState<VaccineEvent[]>([])
    const [dewormings, setDewormings] = useState<DewormingEvent[]>([])
    const [showVaccineForm, setShowVaccineForm] = useState(false)
    const [editingVaccine, setEditingVaccine] = useState<VaccineEvent | null>(null)
    const [showDewormingForm, setShowDewormingForm] = useState(false)
    const [editingDeworming, setEditingDeworming] = useState<DewormingEvent | null>(null)

    // Clinical Info editing state
    const [isEditingClinical, setIsEditingClinical] = useState(false)
    const [clinicalFormData, setClinicalFormData] = useState({
        allergies: '',
        chronic_conditions: '',
        general_notes: ''
    })
    const [savingClinical, setSavingClinical] = useState(false)

    useEffect(() => {
        if (id) {
            fetchPatientData()
        }
    }, [id])

    const fetchPatientData = async () => {
        if (!id) return
        setLoading(true)
        try {
            // Fetch Patient with Tutor join
            const { data: pet, error } = await supabase
                .from('patients')
                .select('*, tutors(*)')
                .eq('id', id as string)
                .single()

            if (error) throw error
            setPatient(pet as Patient)
            setTutor((pet as any).tutors)
            
            // Fetch Permanent Clinical Record (General Notes, Allergies)
            const { data: cData } = await supabase
                .from('clinical_records')
                .select('*')
                .eq('patient_id', id as string)
                .maybeSingle()
            
            const typedCData = cData as ClinicalRecord | null
            setClinicalInfo(typedCData)
            if (typedCData) {
                setClinicalFormData({
                    allergies: typedCData.allergies || '',
                    chronic_conditions: typedCData.chronic_conditions || '',
                    general_notes: typedCData.general_notes || ''
                })
            }

            // Fetch Medical Timeline
            fetchTimeline()
            fetchVaccines()
            fetchDewormings()
        } catch (error) {
            console.error('Error fetching pet profile:', error)
            navigate('/app/tutors')
        } finally {
            setLoading(false)
        }
    }

    const fetchTimeline = async () => {
        if (!id) return
        try {
            const { data, error } = await supabase
                .from('medical_history')
                .select('*')
                .eq('patient_id', id)
                .order('event_date', { ascending: false })

            if (error) throw error
            setHistoryEvents(data as any || [])
        } catch (error) {
            console.error('Error fetching timeline:', error)
        }
    }

    const fetchVaccines = async () => {
        if (!id) return
        try {
            const { data, error } = await supabase.from('vaccines').select('*').eq('patient_id', id).order('application_date', { ascending: false })
            if (error) throw error
            setVaccines(data as any || [])
        } catch (error) { console.error('Error fetching vaccines:', error) }
    }

    const fetchDewormings = async () => {
        if (!id) return
        try {
            const { data, error } = await supabase.from('deworming').select('*').eq('patient_id', id).order('application_date', { ascending: false })
            if (error) throw error
            setDewormings(data as any || [])
        } catch (error) { console.error('Error fetching dewormings:', error) }
    }

    const handleDeleteVaccine = async (vid: string) => {
        if (!confirm('¿Eliminar registro de vacuna?')) return
        try {
            await supabase.from('vaccines').delete().eq('id', vid)
            fetchVaccines()
        } catch (error) { console.error(error) }
    }

    const handleDeleteDeworming = async (did: string) => {
        if (!confirm('¿Eliminar registro de desparasitación?')) return
        try {
            await supabase.from('deworming').delete().eq('id', did)
            fetchDewormings()
        } catch (error) { console.error(error) }
    }

    const handleSaveClinicalInfo = async () => {
        if (!id) return
        setSavingClinical(true)
        try {
            if (clinicalInfo?.id) {
                const { error } = await (supabase.from('clinical_records') as any)
                    .update({
                        allergies: clinicalFormData.allergies,
                        chronic_conditions: clinicalFormData.chronic_conditions,
                        general_notes: clinicalFormData.general_notes,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', clinicalInfo.id)
                if (error) throw error
            } else {
                const { error } = await (supabase.from('clinical_records') as any)
                    .insert([{
                        patient_id: id,
                        clinic_id: patient?.clinic_id,
                        allergies: clinicalFormData.allergies,
                        chronic_conditions: clinicalFormData.chronic_conditions,
                        general_notes: clinicalFormData.general_notes
                    }])
                if (error) throw error
            }
            
            // Refresh
            const { data: newData } = await supabase
                .from('clinical_records')
                .select('*')
                .eq('patient_id', id)
                .maybeSingle()
            setClinicalInfo(newData as any)
            setIsEditingClinical(false)
        } catch (error) {
            console.error('Error saving clinical info:', error)
            alert('Error al guardar antecedentes')
        } finally {
            setSavingClinical(false)
        }
    }

    const handleDeleteEvent = async (eventId: string) => {
        if (!confirm('¿Estás seguro de eliminar este registro histórico?')) return
        try {
            const { error } = await supabase.from('medical_history').delete().eq('id', eventId)
            if (error) throw error
            fetchTimeline()
        } catch (error) {
            console.error('Error deleting event:', error)
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
                <div className="animate-spin w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full" />
                <p className="text-charcoal/50 font-medium tracking-tight">Cargando Ficha Médica...</p>
            </div>
        )
    }

    const formatSpecies = (species: string | null) => {
        const s = species?.toLowerCase() || ''
        if (s.includes('canin') || s.includes('perr') || s.includes('dog')) return 'CANINO'
        if (s.includes('felin') || s.includes('gat') || s.includes('michi')) return 'FELINO'
        return species?.toUpperCase() || '-'
    }

    if (!patient) return null

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            {/* Header / Breadcrumbs */}
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest">
                    <button onClick={() => navigate('/app/tutors')} className="hover:text-primary-600 transition-colors">Tutores</button>
                    <span>/</span>
                    <span className="text-charcoal/60">{tutor?.name}</span>
                    <span>/</span>
                    <span className="text-primary-600 underline underline-offset-4">{patient.name}</span>
                </div>
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-5">
                        <div className="w-16 h-16 rounded-full bg-ivory flex items-center justify-center border-2 border-primary-100 shadow-soft ring-4 ring-white">
                            <Dog className="w-8 h-8 text-primary-600" />
                        </div>
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-3xl font-black text-charcoal tracking-tighter uppercase">{patient.name}</h1>
                                <span className={cn(
                                    "px-2 py-0.5 rounded text-xs font-bold font-bold uppercase tracking-widest border",
                                    patient.status === 'alive' ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-charcoal text-white border-charcoal"
                                )}>
                                    {patient.status === 'alive' ? 'Vivo' : 'Difunto'}
                                </span>
                            </div>
                            <p className="text-charcoal/50 font-bold text-xs uppercase tracking-widest mt-0.5">
                                {formatSpecies(patient.species)} • {patient.breed || 'Sin raza'} • {patient.sex}
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                         <button
                            onClick={() => {
                                setEditingEvent(null)
                                setShowEventForm(true)
                            }}
                            className="btn-primary flex items-center gap-3 shadow-premium py-3 px-6"
                        >
                            <Plus className="w-4 h-4" />
                            Nueva Atención
                        </button>
                    </div>
                </div>
            </div>

            {/* Quick Summary Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card-soft p-5 bg-white border border-silk-beige shadow-sm">
                    <p className="text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest mb-2 leading-none">Edad Estimada</p>
                    <p className="text-xl font-black text-charcoal">
                        {(() => {
                            if (!patient.dob) return 'N/A'
                            const dob = new Date(patient.dob)
                            const now = new Date()
                            
                            let years = now.getFullYear() - dob.getFullYear()
                            let months = now.getMonth() - dob.getMonth()
                            let days = now.getDate() - dob.getDate()

                            if (days < 0) {
                                months -= 1
                            }
                            if (months < 0) {
                                years -= 1
                                months += 12
                            }

                            if (years > 0) {
                                return `${years} ${years === 1 ? 'año' : 'años'}${months > 0 ? ` y ${months} ${months === 1 ? 'mes' : 'meses'}` : ''}`
                            }
                            if (months > 0) {
                                return `${months} ${months === 1 ? 'mes' : 'meses'}`
                            }
                            return `${days > 0 ? days : 1} ${days === 1 ? 'día' : 'días'}`
                        })()}
                    </p>
                </div>
                <div className="card-soft p-5 bg-white border border-silk-beige shadow-sm">
                    <p className="text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest mb-2 leading-none">Último Peso</p>
                    <p className="text-xl font-black text-charcoal">{patient.weight ? `${patient.weight} kg` : 'N/A'}</p>
                </div>
                <div className="card-soft p-5 bg-white border border-silk-beige shadow-sm">
                    <p className="text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest mb-2 leading-none">Esterilizado</p>
                    <p className="text-xl font-black text-charcoal">{patient.is_sterilized ? 'SÍ' : 'NO'}</p>
                </div>
                <div className="card-soft p-5 bg-white border border-silk-beige shadow-sm">
                    <p className="text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest mb-2 leading-none">Tutor Resp.</p>
                    <p className="text-xl font-black text-charcoal truncate uppercase">{tutor?.name || '---'}</p>
                </div>
            </div>

            {/* Main Content Tabs */}
            <div className="flex flex-col gap-6 ">
                <div className="flex items-center gap-1 border-b border-silk-beige overflow-x-auto no-scrollbar bg-white rounded-t-soft h-16">
                    <button
                        onClick={() => setActiveTab('history')}
                        className={cn(
                            "px-8 h-full text-xs font-bold uppercase tracking-widest transition-all relative border-r border-silk-beige whitespace-nowrap",
                            activeTab === 'history' ? "text-primary-700 bg-primary-50/30" : "text-charcoal/40 hover:text-charcoal/60 hover:bg-ivory"
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <ClipboardList className="w-4 h-4" />
                            <span>Atenciones</span>
                        </div>
                        {activeTab === 'history' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary-600" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('medical')}
                        className={cn(
                            "px-8 h-full text-xs font-bold uppercase tracking-widest transition-all relative border-r border-silk-beige whitespace-nowrap",
                            activeTab === 'medical' ? "text-primary-700 bg-primary-50/30" : "text-charcoal/40 hover:text-charcoal/60 hover:bg-ivory"
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <Activity className="w-4 h-4" />
                            <span>Antecedentes</span>
                        </div>
                        {activeTab === 'medical' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary-600" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('vaccines')}
                        className={cn(
                            "px-8 h-full text-xs font-bold uppercase tracking-widest transition-all relative border-r border-silk-beige whitespace-nowrap",
                            activeTab === 'vaccines' ? "text-primary-700 bg-primary-50/30" : "text-charcoal/40 hover:text-charcoal/60 hover:bg-ivory"
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <Syringe className="w-4 h-4" />
                            <span>Vacunas</span>
                        </div>
                        {activeTab === 'vaccines' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary-600" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('deworming')}
                        className={cn(
                            "px-8 h-full text-xs font-bold uppercase tracking-widest transition-all relative whitespace-nowrap",
                            activeTab === 'deworming' ? "text-primary-700 bg-primary-50/30" : "text-charcoal/40 hover:text-charcoal/60 hover:bg-ivory"
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <ShieldAlert className="w-4 h-4" />
                            <span>Parasitología</span>
                        </div>
                        {activeTab === 'deworming' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary-600" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('files')}
                        className={cn(
                            "px-8 h-full text-xs font-bold uppercase tracking-widest transition-all relative border-r border-silk-beige whitespace-nowrap",
                            activeTab === 'files' ? "text-primary-700 bg-primary-50/30" : "text-charcoal/40 hover:text-charcoal/60 hover:bg-ivory"
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <FileText className="w-4 h-4" />
                            <span>Archivos</span>
                        </div>
                        {activeTab === 'files' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary-600" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('reminders')}
                        className={cn(
                            "px-8 h-full text-xs font-bold uppercase tracking-widest transition-all relative whitespace-nowrap",
                            activeTab === 'reminders' ? "text-primary-700 bg-primary-50/30" : "text-charcoal/40 hover:text-charcoal/60 hover:bg-ivory"
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <Bell className="w-4 h-4" />
                            <span>Recordatorios</span>
                        </div>
                        {activeTab === 'reminders' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary-600" />}
                    </button>
                </div>

                <div className="min-h-[500px] animate-slide-up">
                    {activeTab === 'history' && (
                        <div className="space-y-6">
                            {historyEvents.length === 0 ? (
                                <div className="text-center py-24 bg-white rounded-soft border border-dashed border-silk-beige shadow-sm">
                                    <FileText className="w-16 h-16 text-charcoal/10 mx-auto mb-4" />
                                    <h3 className="text-charcoal font-black uppercase tracking-tighter text-xl">Historia en Blanco</h3>
                                    <p className="text-charcoal/40 text-sm mt-1 font-medium max-w-sm mx-auto">Comienza registrando la primera atención médica para crear la línea de tiempo de {patient.name}</p>
                                    <button
                                        onClick={() => setShowEventForm(true)}
                                        className="btn-primary mt-8 py-3 px-8 shadow-premium"
                                    >
                                        Registrar Primera Atención
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-6 relative before:absolute before:left-8 before:top-4 before:bottom-4 before:w-0.5 before:bg-silk-beige/60">
                                    {historyEvents.map(event => (
                                        <div key={event.id} className="relative pl-20 group">
                                            {/* dot */}
                                            <div className="absolute left-6 top-6 w-5 h-5 rounded-full bg-white border-4 border-primary-500 shadow-sm z-10 transition-transform group-hover:scale-125" />
                                            
                                            <div className="bg-white p-6 rounded-soft border border-silk-beige shadow-sm hover:shadow-soft-md transition-all group-hover:border-primary-200">
                                                <div className="flex justify-between items-start mb-5 pb-4 border-b border-silk-beige">
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex flex-col">
                                                            <p className="text-xs font-bold font-bold text-charcoal/30 uppercase tracking-widest leading-none mb-1">
                                                                {new Date(event.event_date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
                                                            </p>
                                                            <h4 className="text-xl font-black text-charcoal uppercase tracking-tighter">{event.event_type}</h4>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={() => {
                                                            setEditingEvent(event)
                                                            setShowEventForm(true)
                                                        }} className="p-2.5 hover:bg-silk-beige text-charcoal/40 hover:text-charcoal rounded-soft">
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => handleDeleteEvent(event.id)} className="p-2.5 hover:bg-red-50 text-charcoal/40 hover:text-red-500 rounded-soft">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="space-y-5">
                                                    <div>
                                                         <p className="text-xs font-bold font-bold text-primary-600 uppercase tracking-widest mb-2 leading-none">Diagnóstico / Motivo</p>
                                                         <p className="text-lg font-bold text-charcoal leading-snug">{event.diagnosis || 'Pendiente'}</p>
                                                    </div>
                                                    
                                                    {event.procedure_notes && (
                                                        <div className="bg-ivory/80 p-5 rounded-soft border border-silk-beige/50">
                                                            <p className="text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest mb-2 leading-none">Notas de Evolución</p>
                                                            <p className="text-charcoal/80 leading-relaxed whitespace-pre-wrap text-sm font-medium">{event.procedure_notes}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    
                    {activeTab === 'medical' && (
                        <div className="bg-white p-10 rounded-soft border border-silk-beige shadow-sm animate-fade-in relative">
                            {/* Toggle Edit Mode */}
                            {!isEditingClinical ? (
                                <button 
                                    onClick={() => setIsEditingClinical(true)}
                                    className="absolute top-6 right-6 p-2.5 bg-ivory hover:bg-silk-beige text-charcoal/60 rounded-soft border border-silk-beige transition-all flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
                                >
                                    <Edit2 className="w-3.5 h-3.5" />
                                    Editar Antecedentes
                                </button>
                            ) : (
                                <div className="absolute top-6 right-6 flex items-center gap-2">
                                    <button 
                                        onClick={() => setIsEditingClinical(false)}
                                        className="p-2.5 bg-white hover:bg-red-50 text-red-600 rounded-soft border border-red-100 transition-all flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
                                        disabled={savingClinical}
                                    >
                                        <X className="w-3.5 h-3.5" />
                                        Cancelar
                                    </button>
                                    <button 
                                        onClick={handleSaveClinicalInfo}
                                        className="p-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-soft shadow-premium transition-all flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
                                        disabled={savingClinical}
                                    >
                                        {savingClinical ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                        Guardar Cambios
                                    </button>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 pt-8">
                                <section className="space-y-8">
                                    <h3 className="text-lg font-black text-charcoal flex items-center gap-3 uppercase tracking-tighter">
                                        <Heart className="w-5 h-5 text-red-500" />
                                        Perfil de Riesgo
                                    </h3>
                                    <div className="space-y-6">
                                        <div className="group relative">
                                            <p className="text-xs font-bold font-bold text-charcoal/30 uppercase tracking-widest mb-2 pl-4 border-l-2 border-red-500">Alergias Conocidas</p>
                                            {isEditingClinical ? (
                                                <input 
                                                    type="text"
                                                    value={clinicalFormData.allergies}
                                                    onChange={(e) => setClinicalFormData({...clinicalFormData, allergies: e.target.value})}
                                                    className="input-soft bg-red-50/10 border-red-100 focus:ring-red-200"
                                                    placeholder="Ej: Penicilina, Pollo, Abejas..."
                                                />
                                            ) : (
                                                <div className="p-5 bg-red-50/30 rounded-soft border border-red-100">
                                                    <p className="text-red-700 font-bold text-sm uppercase">{clinicalInfo?.allergies || 'Sin alergias registradas'}</p>
                                                </div>
                                            )}
                                        </div>
                                        <div className="group relative">
                                            <p className="text-xs font-bold font-bold text-charcoal/30 uppercase tracking-widest mb-2 pl-4 border-l-2 border-amber-500">Enfermedades Crónicas</p>
                                            {isEditingClinical ? (
                                                <input 
                                                    type="text"
                                                    value={clinicalFormData.chronic_conditions}
                                                    onChange={(e) => setClinicalFormData({...clinicalFormData, chronic_conditions: e.target.value})}
                                                    className="input-soft bg-amber-50/10 border-amber-100 focus:ring-amber-200"
                                                    placeholder="Ej: Diabetes, Insuficiencia Renal..."
                                                />
                                            ) : (
                                                <div className="p-5 bg-amber-50/30 rounded-soft border border-amber-100">
                                                    <p className="text-amber-800 font-bold text-sm uppercase">{clinicalInfo?.chronic_conditions || 'Ninguna registrada'}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </section>
                                <section className="space-y-8">
                                    <h3 className="text-lg font-black text-charcoal flex items-center gap-3 uppercase tracking-tighter">
                                        <ClipboardList className="w-5 h-5 text-primary-500" />
                                        Notas Permanentes
                                    </h3>
                                    <div className={cn(
                                        "p-6 bg-ivory rounded-soft border border-silk-beige min-h-[250px] relative group transition-colors",
                                        isEditingClinical && "ring-2 ring-primary-200 border-primary-300"
                                    )}>
                                        {isEditingClinical ? (
                                            <textarea 
                                                value={clinicalFormData.general_notes}
                                                onChange={(e) => setClinicalFormData({...clinicalFormData, general_notes: e.target.value})}
                                                className="w-full h-full bg-transparent border-none focus:ring-0 text-sm text-charcoal font-medium resize-none p-0"
                                                placeholder="Comportamiento, cirugías previas, advertencias..."
                                                rows={8}
                                            />
                                        ) : (
                                            <p className="text-sm text-charcoal/60 leading-relaxed font-medium whitespace-pre-wrap">
                                                {clinicalInfo?.general_notes || 'Utiliza este espacio para notas de comportamiento, cirugías previas importantes o de gran relevancia para el manejo del paciente...'}
                                            </p>
                                        )}
                                    </div>
                                </section>
                            </div>
                        </div>
                    )}
                    
                    {activeTab === 'vaccines' && (
                        <div className="space-y-6 animate-fade-in">
                            <div className="flex justify-between items-center bg-white p-4 rounded-soft border border-silk-beige shadow-sm">
                                <div>
                                    <h3 className="font-bold text-charcoal uppercase tracking-tighter">Registro de Vacunación</h3>
                                    <p className="text-xs text-charcoal/50">Historial de inmunizaciones del paciente</p>
                                </div>
                                <button onClick={() => setShowVaccineForm(true)} className="btn-primary py-2 px-4 flex items-center gap-2 text-sm shadow-premium">
                                    <Plus className="w-4 h-4" /> Agregar Vacuna
                                </button>
                            </div>

                            {vaccines.length === 0 ? (
                                <div className="text-center py-16 bg-white rounded-soft border border-dashed border-silk-beige shadow-sm">
                                    <Syringe className="w-12 h-12 text-primary-200 mx-auto mb-3" />
                                    <h3 className="text-charcoal font-black uppercase tracking-tighter text-lg">Sin Registros</h3>
                                    <p className="text-charcoal/40 text-sm mt-1 max-w-sm mx-auto font-medium">Aún no se han registrado vacunas para este paciente.</p>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    {vaccines.map(v => (
                                        <div key={v.id} className="bg-white p-5 rounded-soft border border-silk-beige flex justify-between items-center group shadow-sm transition-all hover:border-primary-200 hover:shadow-soft-md">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center">
                                                    <Syringe className="w-5 h-5 text-primary-500" />
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-charcoal">{v.name}</h4>
                                                    <p className="text-xs text-charcoal/60 mt-1">
                                                        Aplicada: <span className="font-bold text-charcoal">{new Date(v.application_date).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</span>
                                                        {v.next_dose_date && (
                                                            <> • Próxima: <span className="font-bold text-primary-600">{new Date(v.next_dose_date).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</span></>
                                                        )}
                                                    </p>
                                                    {v.notes && <p className="text-xs text-charcoal/40 mt-1.5">{v.notes}</p>}
                                                </div>
                                            </div>
                                            <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => { setEditingVaccine(v); setShowVaccineForm(true); }} className="p-2.5 text-charcoal/40 hover:text-charcoal hover:bg-silk-beige rounded-soft"><Edit2 className="w-4 h-4" /></button>
                                                <button onClick={() => handleDeleteVaccine(v.id)} className="p-2.5 text-charcoal/40 hover:text-red-500 hover:bg-red-50 rounded-soft ml-1"><Trash2 className="w-4 h-4" /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'deworming' && (
                        <div className="space-y-6 animate-fade-in">
                            <div className="flex justify-between items-center bg-white p-4 rounded-soft border border-silk-beige shadow-sm">
                                <div>
                                    <h3 className="font-bold text-charcoal uppercase tracking-tighter">Control Antiparasitario</h3>
                                    <p className="text-xs text-charcoal/50">Historial interno y externo</p>
                                </div>
                                <button onClick={() => setShowDewormingForm(true)} className="btn-primary py-2 px-4 flex items-center gap-2 text-sm shadow-premium bg-amber-600 hover:bg-amber-700">
                                    <Plus className="w-4 h-4" /> Registrar 
                                </button>
                            </div>

                            {dewormings.length === 0 ? (
                                <div className="text-center py-16 bg-white rounded-soft border border-dashed border-silk-beige shadow-sm">
                                    <ShieldAlert className="w-12 h-12 text-amber-200 mx-auto mb-3" />
                                    <h3 className="text-charcoal font-black uppercase tracking-tighter text-lg">Sin Registros</h3>
                                    <p className="text-charcoal/40 text-sm mt-1 max-w-sm mx-auto font-medium">Aún no se han registrado desparasitaciones para este paciente.</p>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    {dewormings.map(d => (
                                        <div key={d.id} className="bg-white p-5 rounded-soft border border-silk-beige flex justify-between items-center group shadow-sm transition-all hover:border-amber-200 hover:shadow-soft-md">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center">
                                                    <ShieldAlert className="w-5 h-5 text-amber-600" />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <h4 className="font-bold text-charcoal">{d.brand || 'Desparasitación'}</h4>
                                                        <span className="px-2 py-0.5 rounded-full text-[12px] font-bold bg-amber-100 text-amber-700 uppercase">
                                                            {d.type}
                                                        </span>
                                                        {d.weight && <span className="text-xs font-bold text-charcoal/40 ml-2">{d.weight} kg</span>}
                                                    </div>
                                                    <p className="text-xs text-charcoal/60 mt-1.5">
                                                        Aplicada: <span className="font-bold text-charcoal">{new Date(d.application_date).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</span>
                                                        {d.next_dose_date && (
                                                            <> • Próxima: <span className="font-bold text-amber-600">{new Date(d.next_dose_date).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</span></>
                                                        )}
                                                    </p>
                                                    {d.notes && <p className="text-xs text-charcoal/40 mt-1.5">{d.notes}</p>}
                                                </div>
                                            </div>
                                            <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => { setEditingDeworming(d); setShowDewormingForm(true); }} className="p-2.5 text-charcoal/40 hover:text-charcoal hover:bg-silk-beige rounded-soft"><Edit2 className="w-4 h-4" /></button>
                                                <button onClick={() => handleDeleteDeworming(d.id)} className="p-2.5 text-charcoal/40 hover:text-red-500 hover:bg-red-50 rounded-soft ml-1"><Trash2 className="w-4 h-4" /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'files' && (
                        <div className="space-y-6 animate-fade-in">
                            <PatientFiles patientId={id!} />
                        </div>
                    )}

                    {activeTab === 'reminders' && (
                        <div className="space-y-6 animate-fade-in">
                            <PatientReminders patientId={id!} />
                        </div>
                    )}
                </div>
            </div>

            {showEventForm && (
                <MedicalEventForm
                    patientId={patient.id}
                    event={editingEvent}
                    onClose={() => {
                        setShowEventForm(false)
                        setEditingEvent(null)
                    }}
                    onSave={() => {
                        fetchTimeline()
                    }}
                />
            )}

            {showVaccineForm && (
                <VaccineForm
                    patient={patient}
                    event={editingVaccine}
                    onClose={() => {
                        setShowVaccineForm(false)
                        setEditingVaccine(null)
                    }}
                    onSave={() => {
                        fetchVaccines()
                    }}
                />
            )}

            {showDewormingForm && (
                <DewormingForm
                    patient={patient}
                    event={editingDeworming}
                    onClose={() => {
                        setShowDewormingForm(false)
                        setEditingDeworming(null)
                    }}
                    onSave={() => {
                        fetchDewormings()
                    }}
                />
            )}
        </div>
    )
}
