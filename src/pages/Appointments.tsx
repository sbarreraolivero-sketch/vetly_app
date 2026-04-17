import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import {
    Calendar,
    Clock,
    User,
    Phone,
    Search,
    Filter,
    Plus,
    MoreVertical,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Loader2,
    X,
    LayoutList,
    Calendar as CalendarIcon,
    RefreshCw,
    Settings,
    ChevronRight,
    Trash2,
    MessageCircle,
    MapPin,
    ExternalLink,
} from 'lucide-react'
import { cn, formatPhoneNumber, getStatusColor, getStatusLabel } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { CalendarView, CalendarEvent } from '@/components/calendar/CalendarView'
import { MobileCalendarView } from '@/components/calendar/MobileCalendarView'
import { GuideBox } from '@/components/ui/GuideBox'

interface Appointment {
    id: string
    patient_name: string
    tutor_name?: string | null
    phone_number: string
    service: string
    appointment_date: string
    appointment_time: string
    status: 'pending' | 'confirmed' | 'cancelled' | 'completed'
    notes: string | null
    google_event_id?: string | null
    professional_id?: string | null
    address?: string | null
    address_references?: string | null
    duration_minutes?: number
    tutor_id?: string | null
    pet_id?: string | null
}

interface ClinicProfessional {
    member_id: string
    first_name: string | null
    last_name: string | null
    email: string
    role: string
    job_title: string | null
    specialty: string | null
    color: string | null
    working_hours: Record<string, { enabled: boolean; start: string; end: string }> | null
}

const tabs = [
    { id: 'all', label: 'Todas' },
    { id: 'pending', label: 'Pendientes' },
    { id: 'confirmed', label: 'Confirmadas' },
    { id: 'completed', label: 'Completadas' },
]

const INITIAL_FORM_STATE = {
    patient_name: '',
    tutor_name: '',
    phone_number: '',
    service: '',
    appointment_date: '',
    appointment_time: '',
    notes: '',
    professional_id: '',
    address: '',
    address_references: '',
    tutor_id: null as string | null,
    pet_id: null as string | null
}

export default function Appointments() {
    const { user, profile, session, member, loading: authLoading } = useAuth()
    const isProfessional = member?.role === 'professional'
    const [appointments, setAppointments] = useState<Appointment[]>([])
    const [loading, setLoading] = useState(true)
    const [initializing, setInitializing] = useState(true)
    const [activeTab, setActiveTab] = useState('all')
    const [searchQuery, setSearchQuery] = useState('')

    // Modal state
    const [showModal, setShowModal] = useState(false)
    const [saving, setSaving] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [googleEvents] = useState<CalendarEvent[]>([])
    const [newAppointment, setNewAppointment] = useState(INITIAL_FORM_STATE)
    const [services, setServices] = useState<any[]>([])
    const [professionals, setProfessionals] = useState<ClinicProfessional[]>([])
    const [tutors, setTutors] = useState<any[]>([])
    const [filteredTutors, setFilteredTutors] = useState<any[]>([])
    const [showTutorAutocomplete, setShowTutorAutocomplete] = useState(false)
    const [patients, setPatients] = useState<any[]>([])
    const [filteredPatients, setFilteredPatients] = useState<any[]>([])
    const [showPatientAutocomplete, setShowPatientAutocomplete] = useState(false)
    const [professionalFilter, setProfessionalFilter] = useState<string>('all')

    // Date filter state
    const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'tomorrow' | 'week'>('all')
    const [showDatePicker, setShowDatePicker] = useState(false)
    const [showFilters, setShowFilters] = useState(false)
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')

    // Fetch services and professionals
    // Consolidated Fetch Function
    const fetchAllData = async () => {
        if (!profile?.clinic_id) {
            setLoading(false)
            return
        }

        try {
            const threeMonthsAgo = new Date()
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

            // Execute each request individually for robustness
            const fetchAppointments = async () => {
                const { data } = await supabase
                    .from('appointments')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .gte('appointment_date', threeMonthsAgo.toISOString())
                    .order('appointment_date', { ascending: false })
                if (data) setAppointments(data)
            }

            const fetchServices = async () => {
                const { data } = await (supabase as any)
                    .from("clinic_services")
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .order('name')
                if (data) setServices(data)
            }

            const fetchProfessionals = async () => {
                const { data } = await (supabase as any).rpc('get_clinic_professionals', {
                    p_clinic_id: profile.clinic_id
                })
                if (data) setProfessionals(data)
            }

            const fetchTutors = async () => {
                const { data } = await (supabase as any).rpc('get_unified_contacts', {
                    p_clinic_id: profile.clinic_id
                })
                if (data) {
                    const onlyTutors = (data || []).filter((c: any) => c.type === 'tutor')
                    setTutors(onlyTutors)
                }
            }

            const fetchPatients = async () => {
                const { data } = await supabase
                    .from('patients')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .order('name')
                if (data) setPatients(data)
            }

            // Still firing them all but with internal error handling
            await Promise.allSettled([
                fetchAppointments(),
                fetchServices(),
                fetchProfessionals(),
                fetchTutors(),
                fetchPatients()
            ])

        } catch (error) {
            console.error('Error in fetchAllData:', error)
        } finally {
            setLoading(false)
        }
    }

    // Fetch Google Calendar Events via Edge Function
    const fetchGoogleEvents = async () => {
        // Disabled by user request
        return
    }

    useEffect(() => {
        // Only proceed once Auth is done checking
        if (!authLoading) {
            if (profile?.clinic_id) {
                fetchAllData().finally(() => {
                    setInitializing(false)
                    setLoading(false)
                })
            } else {
                // If auth is done but no clinic_id, stop waiting
                setInitializing(false)
                setLoading(false)
            }
        }
    }, [profile?.clinic_id, authLoading])

    // Safety timeout to prevent infinite white screen
    useEffect(() => {
        const timer = setTimeout(() => {
            if (initializing) {
                console.warn('Initialization timeout - forcing UI')
                setInitializing(false)
                setLoading(false)
            }
        }, 5000)
        return () => clearTimeout(timer)
    }, [initializing])

    useEffect(() => {
        if (session?.user) {
            fetchGoogleEvents()
        }
    }, [session?.user?.id])

    const filteredAppointments = React.useMemo(() => {
        if (!Array.isArray(appointments)) return []
        
        return appointments.filter((appointment) => {
            if (!appointment) return false

            const patientName = appointment.patient_name || ''
            const serviceName = appointment.service || ''
            const phoneVal = appointment.phone_number || ''

            const matchesSearch =
                patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                serviceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                phoneVal.includes(searchQuery)

            const matchesTab = activeTab === 'all' || appointment.status === activeTab

            // Professional filter
            let matchesProfessional = true;
            if (isProfessional) {
                matchesProfessional = appointment.professional_id === member?.id;
            } else {
                matchesProfessional = professionalFilter === 'all' || appointment.professional_id === professionalFilter;
            }

            // Date filter logic
            const appointmentDate = new Date(appointment.appointment_date)
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const tomorrow = new Date(today)
            tomorrow.setDate(tomorrow.getDate() + 1)
            const weekEnd = new Date(today)
            weekEnd.setDate(weekEnd.getDate() + 7)

            let matchesDate = true
            if (dateFilter === 'today') {
                const appointmentDay = new Date(appointmentDate)
                appointmentDay.setHours(0, 0, 0, 0)
                matchesDate = appointmentDay.getTime() === today.getTime()
            } else if (dateFilter === 'tomorrow') {
                const appointmentDay = new Date(appointmentDate)
                appointmentDay.setHours(0, 0, 0, 0)
                matchesDate = appointmentDay.getTime() === tomorrow.getTime()
            } else if (dateFilter === 'week') {
                matchesDate = appointmentDate >= today && appointmentDate <= weekEnd
            }

            return matchesSearch && matchesTab && matchesDate && matchesProfessional
        })
    }, [appointments, searchQuery, activeTab, isProfessional, member?.id, professionalFilter, dateFilter])

    // Map appointments to calendar events (excluding cancelled ones for visual clarity)
    const mappedAppointments = React.useMemo(() => {
        if (!Array.isArray(appointments)) return []

        return appointments
            .filter(apt => apt && apt.status !== 'cancelled' && apt.appointment_date)
            .map(apt => {
                try {
                    let start: Date

                    const datePart = apt.appointment_date.includes('T') 
                        ? apt.appointment_date.split('T')[0] 
                        : apt.appointment_date.split(' ')[0]

                    const hasExplicitTime = apt.appointment_time && 
                                          apt.appointment_time !== '00:00' && 
                                          apt.appointment_time !== '00:00:00';

                    if (hasExplicitTime) {
                        const timeStr = apt.appointment_time || '00:00'
                        const [hour, minute] = timeStr.split(':').map(p => p.padStart(2, '0'))
                        start = new Date(`${datePart}T${hour}:${minute}:00`)
                    } else {
                        start = new Date(apt.appointment_date)
                    }

                    if (isNaN(start.getTime())) return null

                    const service = services.find(s => s.name === apt.service)
                    const duration = apt.duration_minutes || (service ? service.duration : 60)
                    const end = new Date(start.getTime() + (duration * 60 * 1000))

                    const prof = apt.professional_id ? professionals.find(p => p.member_id === apt.professional_id) : null

                    return {
                        id: apt.id,
                        title: `${apt.patient_name} - ${apt.service}${apt.address ? ` (${apt.address})` : ''}`,
                        start,
                        end,
                        resource: {
                            type: 'local',
                            ...apt,
                            professionalColor: prof?.color || undefined,
                            professionalName: prof ? `${prof.first_name || ''} ${prof.last_name || ''}`.trim() : undefined
                        }
                    }
                } catch (err) {
                    console.error('Error mapping appointment for calendar:', apt.id, err)
                    return null
                }
            }).filter(Boolean) as CalendarEvent[]
    }, [appointments, services, professionals])

    if (initializing) {
        return (
            <div className="flex items-center justify-center h-screen bg-ivory">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                    <p className="text-emerald-900/60 font-medium animate-pulse">Cargando Vetly...</p>
                </div>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    // Update appointment status
    const updateAppointmentStatus = async (id: string, newStatus: 'confirmed' | 'cancelled' | 'completed') => {
        try {
            // Optimistic update
            const appointment = appointments.find(a => a.id === id)
            if (!appointment) return

            setAppointments(appointments.map(a =>
                a.id === id ? { ...a, status: newStatus } : a
            ))

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error, data } = await (supabase as any)
                .from('appointments')
                .update({ status: newStatus })
                .eq('id', id)
                .select()

            if (error) {
                console.error('Error updating status in DB:', error)
                throw error
            }

            console.log('Status updated successfully:', data)

            if (error) throw error

            // Handle "Completed" status - CRM Integration
            if (newStatus === 'completed') {
                alert('¡Cita completada con éxito!')
            }
            // Sync with Google Calendar
            if (newStatus === 'cancelled') {
                if (appointment?.google_event_id) {
                    console.log('Cancelling Google Event:', appointment.google_event_id)
                    supabase.functions.invoke('delete-google-event', {
                        body: { google_event_id: appointment.google_event_id }
                    }).then(({ error }) => {
                        if (error) console.error('Error deleting Google event:', error)
                        else console.log('Google event deleted successfully')
                    }).catch(err => console.error('Error deleting Google event:', err))
                }
            }

        } catch (error: any) {
            console.error('Error updating status:', error)
            const errorMsg = error.message || 'Error desconocido'
            if (errorMsg.includes('payment_status') || errorMsg.includes('patients_clinic_phone_key')) {
                alert(`Error de base de datos: Es necesario aplicar las actualizaciones de base de datos pendientes (Script SQL) para confirmar citas.\n\nDetalle: ${errorMsg}`)
            } else {
                alert(`Error al actualizar el estado: ${errorMsg}`)
            }
            fetchAllData()
        }
    }

    // Send WhatsApp Reminder
    const handleSendReminder = async (appointment: any) => {
        if (!confirm(`¿Enviar recordatorio a ${appointment.patient_name}?`)) return

        try {
            const { error } = await supabase.functions.invoke('send-whatsapp-reminder', {
                body: { appointment_id: appointment.id }
            })

            if (error) throw error

            alert('Recordatorio enviado correctamente')
        } catch (error: any) {
            console.error('Error sending reminder:', error)
            alert('Error al enviar recordatorio: ' + (error.message || 'Desconocido'))
        }
    }

    // Send Satisfaction Survey
    const handleSendSurvey = async (appointment: Appointment) => {
        if (!confirm(`¿Enviar encuesta de satisfacción a ${appointment.patient_name}?`)) return

        try {
            const { error } = await supabase.functions.invoke('send-whatsapp-survey', {
                body: { appointment_id: appointment.id }
            })

            if (error) throw error

            alert('Encuesta enviada correctamente')
        } catch (error: any) {
            console.error('Error sending survey:', error)
            alert('Error al enviar encuesta: ' + (error.message || 'Desconocido'))
        }
    }




    const handleTutorInputChange = (value: string) => {
        setNewAppointment({ ...newAppointment, tutor_name: value, tutor_id: null })
        
        const query = value.toLowerCase().trim()
        if (query.length > 0) {
            const filtered = (tutors || []).filter((t: any) => {
                const name = (t.name || '').toLowerCase().trim()
                if (!name) return false
                // Match if name starts with query or any word in name starts with query
                const parts = name.split(/\s+/).filter((p: string) => p.length > 0)
                return parts.some((part: string) => part.startsWith(query))
            }).slice(0, 5) // Limit to top 5 results
            setFilteredTutors(filtered)
            setShowTutorAutocomplete(true)
        } else {
            setFilteredTutors([])
            setShowTutorAutocomplete(false)
        }
    }

    const handleTutorSelect = (tutor: any) => {
        setNewAppointment({
            ...newAppointment,
            tutor_name: tutor.name || '',
            phone_number: tutor.phone_number || '',
            address: tutor.address || '',
            tutor_id: tutor.id,
            patient_name: '',
            pet_id: null
        })
        setShowTutorAutocomplete(false)
    }

    const handlePatientInputChange = (value: string) => {
        setNewAppointment({ ...newAppointment, patient_name: value, pet_id: null })
        
        const query = value.toLowerCase().trim()
        if (query.length > 0 && newAppointment.tutor_id) {
            const filtered = (patients || []).filter((p: any) => {
                if (p.tutor_id !== newAppointment.tutor_id) return false
                const name = (p.name || '').toLowerCase().trim()
                if (!name) return false
                const parts = name.split(/\s+/).filter((pPart: string) => pPart.length > 0)
                return parts.some((part: string) => part.startsWith(query))
            }).slice(0, 5)
            setFilteredPatients(filtered)
            setShowPatientAutocomplete(true)
        } else {
            setFilteredPatients([])
            setShowPatientAutocomplete(false)
        }
    }

    const handlePatientSelect = (patient: any) => {
        setNewAppointment({
            ...newAppointment,
            patient_name: patient.name || '',
            pet_id: patient.id
        })
        setShowPatientAutocomplete(false)
    }

    const handleSaveAppointment = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!user || !profile) return

        setSaving(true)
        try {
            // Construct Date from local inputs to get correct UTC time
            const [year, month, day] = newAppointment.appointment_date.split('-').map(Number)
            const [hours, minutes] = newAppointment.appointment_time.split(':').map(Number)
            const localDate = new Date(year, month - 1, day, hours, minutes)
            const appointmentDate = localDate.toISOString()

            let appointmentId = editingId
            let googleEventId = null

            if (editingId) {
                // UPDATE existing appointment
                const updateData = {
                    patient_name: newAppointment.patient_name,
                    tutor_name: newAppointment.tutor_name,
                    phone_number: newAppointment.phone_number,
                    service: newAppointment.service,
                    appointment_date: appointmentDate,
                    notes: newAppointment.notes,
                    professional_id: (newAppointment.professional_id && newAppointment.professional_id.length > 20) ? newAppointment.professional_id : null,
                    address: newAppointment.address,
                    address_references: newAppointment.address_references,
                    tutor_id: newAppointment.tutor_id,
                    pet_id: newAppointment.pet_id
                }
                
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error } = await (supabase as any)
                    .from('appointments')
                    .update(updateData)
                    .eq('id', editingId)
                    .select()
                    .single()

                if (error) throw error

                // Get the existing google_event_id to update it
                const existingAppt = appointments.find(a => a.id === editingId)
                googleEventId = existingAppt?.google_event_id

            } else {
                // CREATE new appointment
                const appointmentData = {
                    clinic_id: profile.clinic_id,
                    patient_name: newAppointment.patient_name,
                    tutor_name: newAppointment.tutor_name,
                    phone_number: newAppointment.phone_number,
                    service: newAppointment.service,
                    appointment_date: appointmentDate,
                    status: 'pending',
                    notes: newAppointment.notes,
                    professional_id: (newAppointment.professional_id && newAppointment.professional_id.length > 20) ? newAppointment.professional_id : null,
                    address: newAppointment.address,
                    address_references: newAppointment.address_references,
                    tutor_id: newAppointment.tutor_id,
                    pet_id: newAppointment.pet_id
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data, error } = await (supabase as any)
                    .from('appointments')
                    .insert([appointmentData])
                    .select()
                    .single()

                if (error) throw error
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                appointmentId = (data as any).id
            }

            // Sync with Google Calendar (Create or Update)
            let durationMinutes = 60
            const selectedServiceObj = services.find(s => s.name === newAppointment.service)
            if (selectedServiceObj) {
                durationMinutes = selectedServiceObj.duration
            }

            const endDate = new Date(new Date(appointmentDate).getTime() + durationMinutes * 60 * 1000).toISOString()

            if (editingId && googleEventId) {
                // Update Google Event
                const { error: googleError } = await supabase.functions.invoke('update-google-event', {
                    body: {
                        google_event_id: googleEventId,
                        title: `${newAppointment.patient_name} - ${newAppointment.service}`,
                        description: newAppointment.notes,
                        start: appointmentDate,
                        end: endDate
                    }
                })

                if (googleError) {
                    console.error('Error syncing update to Google Calendar:', googleError)
                    // alert(`Error debug: ${JSON.stringify(googleError)}`)
                } else {
                    console.log('Google Calendar event updated')
                }
            } else if (!editingId || (editingId && !googleEventId)) {
                // ...
                const { data: googleData, error: googleError } = await supabase.functions.invoke('create-google-event', {
                    body: {
                        title: `${newAppointment.patient_name} - ${newAppointment.service}`,
                        description: newAppointment.notes,
                        start: appointmentDate,
                        end: endDate,
                    },
                })

                if (googleError) {
                    // This handles network/transport errors (like offline or CORS)
                    console.error('Network/Transport error creating Google Calendar event:', googleError)
                    // alert(`Error de conexión: ${JSON.stringify(googleError)}`)
                } else if (!googleData?.success) {
                    // This handles API/Logical errors returned as 200 OK { success: false }
                    console.error('Logic error creating Google Calendar event:', googleData)
                    // alert(`Error de sincronización: ${googleData?.error || 'Desconocido'}\nDetalles: ${JSON.stringify(googleData?.details)}`)
                } else if (googleData?.event_id && appointmentId) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await (supabase as any)
                        .from('appointments')
                        .update({ google_event_id: googleData.event_id })
                        .eq('id', appointmentId)

                    console.log('Synced with Google Calendar:', googleData.event_id)
                }
            }

            setShowModal(false)
            setNewAppointment(INITIAL_FORM_STATE)
            setEditingId(null)

            // Refresh list
            fetchAllData()

        } catch (error: any) {
            console.error('Error creating appointment:', error)
            alert('No pudimos crear la cita: ' + (error.message || 'Error de conexión o base de datos'))
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteAppointment = async (appointment: Appointment) => {
        if (!confirm('¿Estás seguro de que quieres eliminar esta cita?')) return

        try {
            // 1. Delete from Supabase
            const { error } = await supabase
                .from('appointments')
                .delete()
                .eq('id', appointment.id)

            if (error) throw error

            // 2. Remove from local state immediately (functional update)
            setAppointments(prev => prev.filter(a => a.id !== appointment.id))

            // 3. Delete from Google Calendar if linked
            if (appointment.google_event_id) {
                supabase.functions.invoke('delete-google-event', {
                    body: { google_event_id: appointment.google_event_id }
                }).then(({ error: gErr }) => {
                    if (gErr) console.error('Error deleting Google event:', gErr)
                    else console.log('Google event deleted')
                }).catch(err => console.error('Error deleting Google event:', err))
            }

            // 4. Optional: Force refresh from DB just to be 100% sure
            // fetchAllData() 

        } catch (error) {
            console.error('Error deleting appointment:', error)
            alert('Error al eliminar la cita de la base de datos.')
        }
    }


    const getTabCount = (tabId: string) => {
        if (tabId === 'all') return appointments.length
        return appointments.filter((a) => a.status === tabId).length
    }

    const formatDate = (date: string) => {
        const d = new Date(date)
        return d.toLocaleDateString('es-MX', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        })
    }

    const formatTime = (date: string) => {
        const d = new Date(date)
        return d.toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'confirmed':
                return <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            case 'pending':
                return <AlertCircle className="w-4 h-4 text-amber-600" />
            case 'cancelled':
                return <XCircle className="w-4 h-4 text-red-600" />
            case 'completed':
                return <CheckCircle2 className="w-4 h-4 text-primary-600" />
            default:
                return null
        }
    }





    return (
        <div className="space-y-6 animate-fade-in pb-20">
            {/* Header Banner */}
            <div className="bg-hero-gradient rounded-3xl p-8 sm:p-10 text-white relative overflow-hidden shadow-2xl mb-10 border border-white/10">
                {/* Decorative blobs */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none animate-pulse"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary-400/20 rounded-full blur-2xl translate-y-1/3 -translate-x-1/4 pointer-events-none"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
                    <div className="flex items-center gap-6">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner group transition-all duration-500 hover:scale-110">
                            <div className="p-3 bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-600 rounded-xl shadow-lg">
                                <CalendarIcon className="w-8 h-8 sm:w-10 sm:h-10 text-white drop-shadow-md" />
                            </div>
                        </div>
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-[12px] font-bold uppercase tracking-widest mb-3 animate-fade-in">
                                <Clock className="w-3.5 h-3.5 text-amber-300" />
                                <span className="text-amber-50">Control de Agenda</span>
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-black mb-2 tracking-tight drop-shadow-sm uppercase text-white">
                                Citas y Calendario
                            </h1>
                            <p className="text-emerald-50/90 text-sm sm:text-base max-w-xl font-semibold leading-relaxed">
                                Administra tus consultas, cirugías y seguimientos con una visión clara de tu tiempo y productividad.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3">
                        <button
                            onClick={() => setViewMode(viewMode === 'list' ? 'calendar' : 'list')}
                            className="w-full sm:w-auto px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white transition-all font-bold rounded-xl flex items-center justify-center gap-2 border border-white/20 backdrop-blur-sm uppercase text-xs tracking-widest shadow-lg btn-gold-border"
                        >
                            {viewMode === 'list' ? <CalendarIcon className="w-4 h-4" /> : <LayoutList className="w-4 h-4" />}
                            <span>{viewMode === 'list' ? 'Ver Calendario' : 'Ver Lista'}</span>
                        </button>
                        {!isProfessional && (
                                <button
                                    onClick={() => {
                                        const now = new Date()
                                        setNewAppointment({
                                            ...INITIAL_FORM_STATE,
                                            appointment_date: format(now, 'yyyy-MM-dd'),
                                            appointment_time: '09:00',
                                        })
                                        setShowModal(true)
                                    }}
                                    className="w-full sm:w-auto px-8 py-3.5 bg-white text-emerald-900 hover:bg-emerald-50 transition-all font-black rounded-xl flex items-center justify-center gap-2 shadow-premium hover:scale-105 active:scale-95 uppercase text-xs tracking-widest"
                                >
                                    <Plus className="w-5 h-5" />
                                    Nueva Cita
                                </button>
                        )}
                    </div>
                </div>
            </div>

            <GuideBox title="Control de Agenda" summary="Cómo confirmar, reagendar y cancelar citas.">
                <div className="space-y-4">
                    <p>Aprende a gestionar tu agenda de forma más eficiente:</p>
                    <ul className="list-disc pl-5 space-y-2">
                        <li><strong>Vistas Dinámicas:</strong> Alterna entre formato de "Lista" para seguimientos rápidos y "Calendario" para ver tu disponibilidad semanal.</li>
                        <li><strong>Integración con CRM:</strong> Al marcar una cita como completada, podrás agregar notas a la ficha del paciente automáticamente.</li>
                        <li><strong>Recordatorios WhatsApp:</strong> Envía notificaciones presionando el icono de recordatorio al lado de cada cita agendada.</li>
                    </ul>
                </div>
            </GuideBox>

            {/* Filters */}
            <div className="card-soft p-4">
                <div className="flex flex-wrap items-center gap-4">
                    {/* Search */}
                    <div className="flex-1 w-full min-w-[200px] sm:min-w-0 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                        <input
                            type="text"
                            placeholder="Buscar por nombre, servicio o teléfono..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-ivory border border-silk-beige rounded-soft text-sm placeholder:text-charcoal/40 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                        />
                    </div>

                    {/* Date Filter */}
                    <div className="relative">
                        <button
                            onClick={() => setShowDatePicker(!showDatePicker)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 border rounded-soft text-sm transition-colors",
                                dateFilter !== 'all'
                                    ? "bg-primary-50 border-primary-300 text-primary-700"
                                    : "bg-ivory border-silk-beige text-charcoal/70 hover:bg-silk-beige/50"
                            )}
                        >
                            <Calendar className="w-4 h-4" />
                            {dateFilter === 'all' ? 'Fecha' :
                                dateFilter === 'today' ? 'Hoy' :
                                    dateFilter === 'tomorrow' ? 'Mañana' : 'Esta Semana'}
                        </button>

                        {showDatePicker && (
                            <div className="absolute top-full left-0 mt-2 bg-white rounded-soft shadow-premium-lg border border-silk-beige py-2 min-w-[150px] z-10">
                                <button
                                    onClick={() => { setDateFilter('all'); setShowDatePicker(false); }}
                                    className={cn(
                                        "w-full px-4 py-2 text-left text-sm hover:bg-ivory transition-colors",
                                        dateFilter === 'all' && "bg-primary-50 text-primary-700"
                                    )}
                                >
                                    Todas las fechas
                                </button>
                                <button
                                    onClick={() => { setDateFilter('today'); setShowDatePicker(false); }}
                                    className={cn(
                                        "w-full px-4 py-2 text-left text-sm hover:bg-ivory transition-colors",
                                        dateFilter === 'today' && "bg-primary-50 text-primary-700"
                                    )}
                                >
                                    Hoy
                                </button>
                                <button
                                    onClick={() => { setDateFilter('tomorrow'); setShowDatePicker(false); }}
                                    className={cn(
                                        "w-full px-4 py-2 text-left text-sm hover:bg-ivory transition-colors",
                                        dateFilter === 'tomorrow' && "bg-primary-50 text-primary-700"
                                    )}
                                >
                                    Mañana
                                </button>
                                <button
                                    onClick={() => { setDateFilter('week'); setShowDatePicker(false); }}
                                    className={cn(
                                        "w-full px-4 py-2 text-left text-sm hover:bg-ivory transition-colors",
                                        dateFilter === 'week' && "bg-primary-50 text-primary-700"
                                    )}
                                >
                                    Esta Semana
                                </button>
                            </div>
                        )}
                    </div>

                    {/* More Filters */}
                    <div className="relative">
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 border rounded-soft text-sm transition-colors",
                                showFilters
                                    ? "bg-primary-50 border-primary-300 text-primary-700"
                                    : "bg-ivory border-silk-beige text-charcoal/70 hover:bg-silk-beige/50"
                            )}
                        >
                            <Filter className="w-4 h-4" />
                            Filtros
                        </button>

                        {showFilters && (
                            <div className="absolute top-full right-0 mt-2 bg-white rounded-soft shadow-premium-lg border border-silk-beige p-4 min-w-[200px] z-10">
                                <p className="text-xs font-medium text-charcoal/50 uppercase mb-3">Ordenar por</p>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 text-sm text-charcoal cursor-pointer">
                                        <input type="radio" name="sort" defaultChecked className="accent-primary-500" />
                                        Fecha (más reciente)
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-charcoal cursor-pointer">
                                        <input type="radio" name="sort" className="accent-primary-500" />
                                        Fecha (más antigua)
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-charcoal cursor-pointer">
                                        <input type="radio" name="sort" className="accent-primary-500" />
                                        Nombre (A-Z)
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Sync Button - Disabled by user request */}
                    {/* <button
                        onClick={() => setShowSettingsModal(true)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2.5 border rounded-soft text-sm transition-colors",
                            googleEvents.length > 0
                                ? "bg-white border-silk-beige text-charcoal hover:bg-silk-beige/50"
                                : "bg-ivory border-silk-beige text-charcoal/70 hover:bg-silk-beige/50"
                        )}
                        title="Configurar Sincronización"
                    >
                        <RefreshCw className={cn("w-4 h-4", isSyncing && "animate-spin")} />
                        <span className="hidden sm:inline">Sync</span>
                        {googleEvents.length > 0 && (
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        )}
                    </button> */}

                    {/* View Toggle */}
                    <div className="flex bg-ivory border border-silk-beige rounded-soft p-1">
                        <button
                            onClick={() => setViewMode('list')}
                            className={cn(
                                "p-2 rounded-soft transition-all",
                                viewMode === 'list'
                                    ? "bg-white shadow-soft text-primary-600"
                                    : "text-charcoal/40 hover:text-charcoal"
                            )}
                            title="Vista de Lista"
                        >
                            <LayoutList className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setViewMode('calendar')}
                            className={cn(
                                "p-2 rounded-soft transition-all",
                                viewMode === 'calendar'
                                    ? "bg-white shadow-soft text-primary-600"
                                    : "text-charcoal/40 hover:text-charcoal"
                            )}
                            title="Vista de Calendario"
                        >
                            <CalendarIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {viewMode === 'list' && (
                    <div className="flex gap-2 mt-4 border-t border-silk-beige pt-4 overflow-x-auto pb-2 scrollbar-none">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    'whitespace-nowrap flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-soft text-sm font-medium transition-colors',
                                    activeTab === tab.id
                                        ? 'bg-primary-500 text-white'
                                        : 'text-charcoal/60 hover:bg-silk-beige/50 hover:text-charcoal'
                                )}
                            >
                                {tab.label}
                                <span
                                    className={cn(
                                        'w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0',
                                        activeTab === tab.id ? 'bg-white/20' : 'bg-silk-beige'
                                    )}
                                >
                                    {getTabCount(tab.id)}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Professional Filter Pills */}
            {!isProfessional && professionals.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-charcoal/50 uppercase tracking-wide mr-1">Profesional:</span>
                    <button
                        onClick={() => setProfessionalFilter('all')}
                        className={cn(
                            'px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
                            professionalFilter === 'all'
                                ? 'bg-charcoal text-white border-charcoal'
                                : 'bg-ivory text-charcoal/60 border-silk-beige hover:border-charcoal/30'
                        )}
                    >
                        Todos
                    </button>
                    {professionals.map((prof) => (
                        <button
                            key={prof.member_id}
                            onClick={() => setProfessionalFilter(prof.member_id)}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
                                professionalFilter === prof.member_id
                                    ? 'bg-charcoal text-white border-charcoal'
                                    : 'bg-ivory text-charcoal/60 border-silk-beige hover:border-charcoal/30'
                            )}
                        >
                            <div
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: prof.color || '#8B5CF6' }}
                            />
                            {prof.first_name || prof.email}
                        </button>
                    ))}
                </div>
            )}

            {viewMode === 'calendar' ? (
                <>
                    {/* Desktop Calendar View */}
                    <div className="hidden md:block">
                        <CalendarView
                            onEditEvent={(event) => {
                                // Check if it's a google event
                                if (event.resource?.type === 'google') {
                                    // Ideally show a toast
                                    console.log('Google event selected, cannot edit directly yet')
                                    alert('No se pueden editar eventos de Google directamente desde aquí.')
                                    return
                                }
                                setEditingId(event.id)
                                setNewAppointment({
                                    patient_name: event.resource.patient_name,
                                    tutor_name: event.resource.tutor_name || '',
                                    phone_number: event.resource.phone_number || '',
                                    service: event.resource.service,
                                    appointment_date: format(event.start, 'yyyy-MM-dd'),
                                    appointment_time: format(event.start, 'HH:mm'),
                                    notes: event.resource.notes || '',
                                    professional_id: event.resource.professional_id || '',
                                    address: event.resource.address || '',
                                    address_references: event.resource.address_references || '',
                                    tutor_id: event.resource.tutor_id || null,
                                    pet_id: event.resource.pet_id || null
                                })
                                setShowModal(true)
                            }}
                            events={[
                                ...mappedAppointments,
                                // ...googleEvents // Disabled by user request
                            ]}
                            onSelectEvent={(event) => {
                                // Debug log 
                                console.log('Event clicked:', event)

                                // Check if it's a google event to prevent editing (or show info)
                                if (event.resource?.type === 'google') {
                                    console.log('Google event selected, cannot edit directly yet')
                                    return
                                }

                                // Populate form for editing
                                setEditingId(event.id)
                                setNewAppointment({
                                    patient_name: event.resource.patient_name,
                                    tutor_name: event.resource.tutor_name || '',
                                    phone_number: event.resource.phone_number || '',
                                    service: event.resource.service,
                                    appointment_date: format(event.start, 'yyyy-MM-dd'),
                                    appointment_time: format(event.start, 'HH:mm'),
                                    notes: event.resource.notes || '',
                                    professional_id: event.resource.professional_id || '',
                                    address: event.resource.address || '',
                                    address_references: event.resource.address_references || '',
                                    tutor_id: event.resource.tutor_id || null,
                                    pet_id: event.resource.pet_id || null
                                })
                                setShowModal(true)
                            }}
                            onSelectSlot={(slotInfo) => {
                                setNewAppointment({
                                    ...newAppointment,
                                    appointment_date: slotInfo.start.toISOString().split('T')[0],
                                    appointment_time: slotInfo.start.toTimeString().slice(0, 5)
                                })
                                setShowModal(true)
                            }}
                        />
                    </div>

                    {/* Mobile Calendar View (Google Calendar Style) */}
                    <div className="block md:hidden">
                        <MobileCalendarView
                            events={[
                                ...mappedAppointments,
                            ]}
                            onSelectEvent={(event) => {
                                // Re-use the exact same logic
                                if (event.resource?.type === 'google') {
                                    alert('No se pueden editar eventos de Google directamente desde aquí.')
                                    return
                                }
                                setEditingId(event.id)
                                setNewAppointment({
                                    patient_name: event.resource.patient_name,
                                    tutor_name: event.resource.tutor_name || '',
                                    phone_number: event.resource.phone_number || '',
                                    service: event.resource.service,
                                    appointment_date: format(event.start, 'yyyy-MM-dd'),
                                    appointment_time: format(event.start, 'HH:mm'),
                                    notes: event.resource.notes || '',
                                    professional_id: event.resource.professional_id || '',
                                    address: event.resource.address || '',
                                    address_references: event.resource.address_references || '',
                                    tutor_id: event.resource.tutor_id || null,
                                    pet_id: event.resource.pet_id || null
                                })
                                setShowModal(true)
                            }}
                            onSelectSlot={(date) => {
                                setNewAppointment({
                                    ...newAppointment,
                                    appointment_date: date.toISOString().split('T')[0],
                                    appointment_time: '09:00'
                                })
                                // Removed setShowModal(true) to avoid opening unexpectedly on day touches
                            }}
                        />
                    </div>
                </>
            ) : (
                <>
                    {/* Appointments Table (Desktop) */}
                    <div className="card-soft overflow-x-auto hidden md:block">
                        <table className="w-full min-w-[800px]">
                            <thead>
                                <tr className="border-b border-silk-beige bg-ivory/50">
                                    <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/60">Tutor</th>
                                    <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/60">Paciente</th>
                                    <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/60">Servicio</th>
                                    <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/60">Dirección</th>
                                    <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/60">Fecha y Hora</th>
                                    <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/60">Estado</th>
                                    <th className="text-right py-4 px-6 text-sm font-medium text-charcoal/60">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredAppointments.map((appointment, index) => (
                                    <tr
                                        key={appointment.id}
                                        className={cn(
                                            'border-b border-silk-beige/50 hover:bg-ivory/50 transition-colors',
                                            index === filteredAppointments.length - 1 && 'border-b-0'
                                        )}
                                    >
                                        <td className="py-4 px-6 text-sm font-medium text-charcoal">
                                            {appointment.tutor_name || 'Desconocido'}
                                        </td>
                                        <td className="py-4 px-6">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-silk-beige rounded-full flex items-center justify-center">
                                                    <User className="w-5 h-5 text-charcoal/50" />
                                                </div>
                                                <div>
                                                    <p className="font-medium text-charcoal">{appointment.patient_name}</p>
                                                    <p className="text-sm text-charcoal/50 flex items-center gap-1">
                                                        <Phone className="w-3 h-3" />
                                                        {formatPhoneNumber(appointment.phone_number)}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-4 px-6">
                                            <p className="text-charcoal">{appointment.service}</p>
                                            {appointment.notes && (
                                                <p className="text-sm text-charcoal/50 mt-0.5">{appointment.notes}</p>
                                            )}
                                        </td>
                                        <td className="py-4 px-6 text-sm text-charcoal max-w-[200px] truncate" title={appointment.address || ''}>
                                            <div className="flex flex-col">
                                                <span className="truncate">{appointment.address || 'Linares Base'}</span>
                                                {appointment.address_references && (
                                                    <span className="text-[10px] text-charcoal/40 italic truncate">
                                                        Ref: {appointment.address_references}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-4 px-6">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="w-4 h-4 text-charcoal/40" />
                                                <div>
                                                    <p className="text-charcoal capitalize">{formatDate(appointment.appointment_date)}</p>
                                                    <p className="text-sm text-charcoal/50 flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        {formatTime(appointment.appointment_date)}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-4 px-6">
                                            <span className={cn('inline-flex items-center gap-1.5', getStatusColor(appointment.status))}>
                                                {getStatusIcon(appointment.status)}
                                                {getStatusLabel(appointment.status)}
                                            </span>
                                        </td>
                                        <td className="py-4 px-6 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {appointment.status === 'pending' && (
                                                    <>
                                                        <button
                                                            onClick={() => updateAppointmentStatus(appointment.id, 'confirmed')}
                                                            className="px-3 py-1.5 text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-soft transition-colors"
                                                        >
                                                            Confirmar
                                                        </button>
                                                        <button
                                                            onClick={() => updateAppointmentStatus(appointment.id, 'cancelled')}
                                                            className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-soft transition-colors"
                                                        >
                                                            Cancelar
                                                        </button>
                                                    </>
                                                )}
                                                {appointment.status === 'confirmed' && (
                                                    <button
                                                        onClick={() => updateAppointmentStatus(appointment.id, 'completed')}
                                                        className="px-3 py-1.5 text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-soft transition-colors"
                                                    >
                                                        Completar
                                                    </button>
                                                )}
                                                {appointment.status === 'completed' && (
                                                    <button
                                                        onClick={() => handleSendSurvey(appointment)}
                                                        className="px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-soft transition-colors flex items-center gap-1"
                                                        title="Enviar Encuesta de Satisfacción"
                                                    >
                                                        <MessageCircle className="w-3 h-3" />
                                                        Encuesta
                                                    </button>
                                                )}
                                                {(appointment.status === 'confirmed' || appointment.status === 'pending') && (
                                                    <button
                                                        onClick={() => handleSendReminder(appointment)}
                                                        className="p-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-soft transition-colors"
                                                        title="Enviar Recordatorio WhatsApp"
                                                    >
                                                        <MessageCircle className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <div className="relative group">
                                                    <button className="p-2 text-charcoal/50 hover:text-charcoal hover:bg-ivory rounded-soft transition-colors">
                                                        <MoreVertical className="w-4 h-4" />
                                                    </button>

                                                    {/* Dropdown Menu */}
                                                    <div className={cn(
                                                        "absolute right-0 w-48 hidden group-hover:block z-50",
                                                        (index >= filteredAppointments.length - 2) ? "bottom-full mb-1" : "top-full pt-1"
                                                    )}>
                                                        <div className="bg-white rounded-soft shadow-premium border border-silk-beige overflow-hidden">
                                                            <button
                                                                onClick={() => {
                                                                    setEditingId(appointment.id) // Set editing mode
                                                                    setNewAppointment({
                                                                        patient_name: appointment.patient_name,
                                                                        tutor_name: appointment.tutor_name || '',
                                                                        phone_number: appointment.phone_number,
                                                                        service: appointment.service,
                                                                        appointment_date: appointment.appointment_date.split('T')[0],
                                                                        appointment_time: appointment.appointment_date.split('T')[1].slice(0, 5),
                                                                        notes: appointment.notes || '',
                                                                        professional_id: appointment.professional_id || '',
                                                                        address: appointment.address || '',
                                                                        address_references: appointment.address_references || '',
                                                                        tutor_id: appointment.tutor_id || null,
                                                                        pet_id: appointment.pet_id || null
                                                                    })
                                                                    setShowModal(true) // Open modal
                                                                }}
                                                                className="w-full text-left px-4 py-2 text-sm text-charcoal hover:bg-gray-50 flex items-center gap-2"
                                                            >
                                                                <Settings className="w-4 h-4" />
                                                                Editar Cita
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteAppointment(appointment)}
                                                                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                                Eliminar Cita
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {filteredAppointments.length === 0 && (
                            <div className="py-12 text-center">
                                <Calendar className="w-12 h-12 text-charcoal/20 mx-auto mb-4" />
                                <p className="text-charcoal/50">No se encontraron citas</p>
                            </div>
                        )}
                    </div>

                    {/* Appointments Cards (Mobile) */}
                    <div className="block md:hidden space-y-4">
                        {filteredAppointments.length > 0 ? filteredAppointments.map((appointment) => (
                            <div key={`mob-${appointment.id}`} className="bg-white rounded-2xl p-5 shadow-sm border border-silk-beige flex flex-col gap-4">
                                {/* Header: Patient & Status */}
                                <div className="flex justify-between items-start gap-3">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="w-10 h-10 bg-silk-beige rounded-full flex items-center justify-center flex-shrink-0">
                                            <User className="w-5 h-5 text-charcoal/50" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-col">
                                                <p className="text-[10px] font-bold text-primary-600 uppercase tracking-widest mb-0.5">Tutor: {appointment.tutor_name || 'Desconocido'}</p>
                                                <p className="font-bold text-charcoal truncate text-sm sm:text-base leading-tight">
                                                    {appointment.patient_name}
                                                </p>
                                            </div>
                                            <div className="flex flex-col gap-1 mt-1">
                                                <p className="text-xs font-bold sm:text-xs text-charcoal/40 flex items-center gap-1">
                                                    <Phone className="w-3 h-3" />
                                                    {formatPhoneNumber(appointment.phone_number)}
                                                </p>
                                                <span className={cn('inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full w-fit font-bold uppercase tracking-wider border mt-1', getStatusColor(appointment.status))}>
                                                    {getStatusIcon(appointment.status)}
                                                    {getStatusLabel(appointment.status)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Body: Service & Time */}
                                <div className="bg-ivory/80 rounded-xl p-3 flex flex-col gap-2.5">
                                    <div className="flex justify-between items-start gap-2">
                                        <span className="text-xs font-bold font-semibold text-charcoal/50 uppercase tracking-widest flex-shrink-0 mt-0.5">Dirección</span>
                                        <div className="text-right min-w-0">
                                            <p className="text-sm font-medium text-charcoal leading-tight truncate">{appointment.address || 'Linares Base'}</p>
                                            {appointment.address_references && (
                                                <p className="text-[10px] text-charcoal/40 italic mt-0.5 line-clamp-1">{appointment.address_references}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="h-px w-full bg-silk-beige/50"></div>
                                    <div className="flex justify-between items-center gap-2">
                                        <span className="text-xs font-bold font-semibold text-charcoal/50 uppercase tracking-widest flex-shrink-0">Servicio</span>
                                        <span className="text-sm font-medium text-charcoal text-right truncate">{appointment.service}</span>
                                    </div>
                                    {appointment.notes && (
                                        <div className="p-2.5 bg-amber-50/50 border border-amber-100 rounded-xl">
                                            <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" />
                                                Motivo / Síntomas
                                            </p>
                                            <p className="text-xs text-charcoal/80 leading-relaxed italic">
                                                "{appointment.notes}"
                                            </p>
                                        </div>
                                    )}
                                    <div className="h-px w-full bg-silk-beige/50"></div>
                                    <div className="flex justify-between items-center gap-2">
                                        <span className="text-xs font-bold font-semibold text-charcoal/50 uppercase tracking-widest flex-shrink-0">Fecha / Hora</span>
                                        <div className="text-right">
                                            <span className="text-sm font-semibold text-charcoal block capitalize">{formatDate(appointment.appointment_date)}</span>
                                            <span className="text-xs text-charcoal/60 flex items-center justify-end gap-1 mt-0.5 font-medium">
                                                <div className="w-1.5 h-1.5 rounded-full bg-primary-500"></div>
                                                {formatTime(appointment.appointment_date)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer: Actions */}
                                <div className="flex gap-2 pt-1 border-t border-silk-beige/30 mt-1 pb-1">
                                    {appointment.status === 'pending' && (
                                        <>
                                            <button
                                                onClick={() => updateAppointmentStatus(appointment.id, 'confirmed')}
                                                className="flex-1 py-2 text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-colors"
                                            >
                                                Confirmar
                                            </button>
                                            <button
                                                onClick={() => updateAppointmentStatus(appointment.id, 'cancelled')}
                                                className="flex-1 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors"
                                            >
                                                Cancelar
                                            </button>
                                        </>
                                    )}
                                    {appointment.status === 'confirmed' && (
                                        <button
                                            onClick={() => updateAppointmentStatus(appointment.id, 'completed')}
                                            className="flex-1 py-2 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
                                        >
                                            Completar
                                        </button>
                                    )}
                                    {appointment.status === 'completed' && (
                                        <button
                                            onClick={() => handleSendSurvey(appointment)}
                                            className="flex-1 py-2 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors flex justify-center items-center gap-1.5"
                                        >
                                            <MessageCircle className="w-3.5 h-3.5" />
                                            Encuesta
                                        </button>
                                    )}

                                    {(appointment.status === 'confirmed' || appointment.status === 'pending') && (
                                        <button
                                            onClick={() => handleSendReminder(appointment)}
                                            className="p-2.5 text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 rounded-xl transition-colors flex justify-center items-center"
                                            title="WhatsApp"
                                        >
                                            <MessageCircle className="w-4 h-4" />
                                        </button>
                                    )}

                                    <button
                                        onClick={() => {
                                            setEditingId(appointment.id)
                                            setNewAppointment({
                                                patient_name: appointment.patient_name,
                                                tutor_name: appointment.tutor_name || '',
                                                phone_number: appointment.phone_number,
                                                service: appointment.service,
                                                appointment_date: appointment.appointment_date.split('T')[0],
                                                appointment_time: appointment.appointment_date.split('T')[1].slice(0, 5),
                                                notes: appointment.notes || '',
                                                professional_id: appointment.professional_id || '',
                                                address: appointment.address || '',
                                                address_references: appointment.address_references || '',
                                                tutor_id: appointment.tutor_id || null,
                                                pet_id: appointment.pet_id || null
                                            })
                                            setShowModal(true)
                                        }}
                                        className="p-2.5 text-charcoal/60 hover:text-charcoal bg-ivory/50 hover:bg-silk-beige rounded-xl transition-colors flex justify-center items-center"
                                    >
                                        <Settings className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )) : (
                            <div className="py-12 flex flex-col items-center justify-center bg-white rounded-2xl border border-silk-beige text-charcoal/40 space-y-3">
                                <Calendar className="w-12 h-12 opacity-20" />
                                <p className="font-medium text-sm text-center">No hay citas en este rango temporal</p>
                            </div>
                        )}
                    </div>

                    {/* Google Calendar Events Section */}
                    {googleEvents.length > 0 && (
                        <div className="card-soft overflow-hidden mt-4">
                            <div className="flex items-center justify-between p-4 border-b border-silk-beige bg-blue-50/50">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                                    <h3 className="font-medium text-charcoal text-sm">Google Calendar</h3>
                                    <span className="text-xs text-charcoal/50 bg-blue-100 px-2 py-0.5 rounded-full">
                                        {googleEvents.length} eventos
                                    </span>
                                </div>
                                <button
                                    onClick={fetchGoogleEvents}
                                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors"
                                >
                                    <RefreshCw className={cn("w-3 h-3")} />
                                    Actualizar
                                </button>
                            </div>
                            <div className="divide-y divide-silk-beige/50">
                                {googleEvents
                                    .filter(event => {
                                        const eventDate = new Date(event.start)
                                        const now = new Date()
                                        now.setHours(0, 0, 0, 0)
                                        return eventDate >= now
                                    })
                                    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
                                    .slice(0, 10)
                                    .map((event) => (
                                        <div
                                            key={event.id}
                                            className="flex items-center gap-4 p-4 hover:bg-ivory/50 transition-colors"
                                        >
                                            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center flex-shrink-0">
                                                <Calendar className="w-5 h-5 text-blue-500" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-charcoal truncate">{event.title}</p>
                                                {event.resource?.description && (
                                                    <p className="text-xs text-charcoal/50 truncate mt-0.5">{event.resource.description}</p>
                                                )}
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                <p className="text-sm text-charcoal capitalize">
                                                    {new Date(event.start).toLocaleDateString('es-MX', {
                                                        weekday: 'short',
                                                        day: 'numeric',
                                                        month: 'short',
                                                    })}
                                                </p>
                                                <p className="text-xs text-charcoal/50 flex items-center gap-1 justify-end">
                                                    <Clock className="w-3 h-3" />
                                                    {event.resource?.isAllDay ? 'Todo el día' : new Date(event.start).toLocaleTimeString('es-MX', {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </p>
                                            </div>
                                            {event.resource?.htmlLink && (
                                                <a
                                                    href={event.resource.htmlLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="p-2 text-blue-500 hover:text-blue-600 hover:bg-blue-50 rounded-soft transition-colors"
                                                    title="Abrir en Google Calendar"
                                                >
                                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                                        <polyline points="15 3 21 3 21 9" />
                                                        <line x1="10" y1="14" x2="21" y2="3" />
                                                    </svg>
                                                </a>
                                            )}
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}
                </>
            )
            }

            {/* New Appointment Modal */}
            {
                showModal && createPortal(
                    <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                        <div className="bg-white rounded-soft shadow-premium-lg w-full max-w-lg animate-scale-in max-h-[90vh] flex flex-col">
                            <div className="flex items-center justify-between p-6 border-b border-silk-beige flex-shrink-0">
                                <h2 className="text-xl font-bold text-charcoal">
                                    {editingId ? 'Editar Cita' : 'Nueva Cita'}
                                </h2>
                                <button
                                    onClick={() => {
                                        setShowModal(false)
                                        setEditingId(null)
                                        setNewAppointment(INITIAL_FORM_STATE)
                                    }}
                                    className="p-2 hover:bg-ivory rounded-soft transition-colors"
                                >
                                    <X className="w-5 h-5 text-charcoal/50" />
                                </button>
                            </div>

                            <div className="p-6 space-y-4 overflow-y-auto flex-1">
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-2">
                                        Nombre del Tutor (Dueño) *
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={newAppointment.tutor_name}
                                            onChange={(e) => handleTutorInputChange(e.target.value)}
                                            onFocus={() => {
                                                if (newAppointment.tutor_name && filteredTutors.length > 0) {
                                                    setShowTutorAutocomplete(true)
                                                }
                                            }}
                                            placeholder="Ej: Claudio González"
                                            className="input-soft w-full"
                                        />
                                        {showTutorAutocomplete && filteredTutors.length > 0 && (
                                            <div className="absolute top-full left-0 right-0 z-[110] mt-1 bg-white rounded-xl shadow-premium-lg border border-silk-beige overflow-hidden animate-scale-in">
                                                <div className="p-2 border-b border-silk-beige bg-ivory/30">
                                                    <p className="text-[10px] font-bold text-primary-600 uppercase tracking-widest">Tutores Encontrados</p>
                                                </div>
                                                {filteredTutors.map((tutor) => (
                                                    <button
                                                        key={tutor.id}
                                                        type="button"
                                                        onClick={() => handleTutorSelect(tutor)}
                                                        className="w-full text-left px-4 py-3 hover:bg-primary-50 flex flex-col transition-colors border-b border-silk-beige/30 last:border-0 group"
                                                    >
                                                        <span className="text-sm font-bold text-charcoal uppercase group-hover:text-primary-700">{tutor.name}</span>
                                                        <span className="text-[10px] text-charcoal/40 flex items-center gap-2 mt-0.5">
                                                            <div className="flex items-center gap-1">
                                                                <Phone className="w-2.5 h-2.5" /> {tutor.phone_number}
                                                            </div>
                                                            {tutor.address && (
                                                                <div className="flex items-center gap-1">
                                                                    <MapPin className="w-2.5 h-2.5" /> <span className="truncate max-w-[150px]">{tutor.address}</span>
                                                                </div>
                                                            )}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {showTutorAutocomplete && (
                                            <div 
                                                className="fixed inset-0 z-[105]" 
                                                onClick={() => setShowTutorAutocomplete(false)}
                                            />
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-2">
                                        Nombre del Paciente (Mascota)
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={newAppointment.patient_name}
                                            onChange={(e) => handlePatientInputChange(e.target.value)}
                                            onFocus={() => {
                                                if (newAppointment.tutor_id && filteredPatients.length > 0) {
                                                    setShowPatientAutocomplete(true)
                                                }
                                            }}
                                            placeholder="Ej: Max"
                                            className="input-soft w-full"
                                        />
                                        {showPatientAutocomplete && filteredPatients.length > 0 && (
                                            <div className="absolute top-full left-0 right-0 z-[110] mt-1 bg-white rounded-xl shadow-premium-lg border border-silk-beige overflow-hidden animate-scale-in">
                                                <div className="p-2 border-b border-silk-beige bg-ivory/30">
                                                    <p className="text-[10px] font-bold text-primary-600 uppercase tracking-widest">Mascotas del Tutor</p>
                                                </div>
                                                {filteredPatients.map((patient) => (
                                                    <button
                                                        key={patient.id}
                                                        type="button"
                                                        onClick={() => handlePatientSelect(patient)}
                                                        className="w-full text-left px-4 py-3 hover:bg-primary-50 flex flex-col transition-colors border-b border-silk-beige/30 last:border-0 group"
                                                    >
                                                        <span className="text-sm font-bold text-charcoal uppercase group-hover:text-primary-700">{patient.name}</span>
                                                        <span className="text-[10px] text-charcoal/40 mt-0.5">
                                                            {patient.species || 'Especie no especificada'} {patient.breed ? `• ${patient.breed}` : ''}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {showPatientAutocomplete && (
                                            <div 
                                                className="fixed inset-0 z-[105]" 
                                                onClick={() => setShowPatientAutocomplete(false)}
                                            />
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-2">
                                        Teléfono *
                                    </label>
                                    <input
                                        type="tel"
                                        value={newAppointment.phone_number}
                                        onChange={(e) => setNewAppointment({ ...newAppointment, phone_number: e.target.value })}
                                        placeholder="Ej: 56912345678"
                                        className="input-soft w-full"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-2">
                                        Servicio *
                                    </label>
                                    <div className="relative">
                                        <select
                                            value={newAppointment.service}
                                            onChange={(e) => {
                                                setNewAppointment({
                                                    ...newAppointment,
                                                    service: e.target.value
                                                })
                                            }}
                                            className="input-soft w-full appearance-none"
                                        >
                                            <option value="">Selecciona un servicio</option>
                                            {services.map((service) => (
                                                <option key={service.id} value={service.name}>
                                                    {service.name} ({service.duration} min) - ${service.price}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40 rotate-90 pointer-events-none" />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-2">
                                        Profesional
                                    </label>
                                    <div className="relative">
                                        <select
                                            value={newAppointment.professional_id}
                                            onChange={(e) => {
                                                setNewAppointment({
                                                    ...newAppointment,
                                                    professional_id: e.target.value
                                                })
                                            }}
                                            className="input-soft w-full appearance-none"
                                        >
                                            <option value="">Sin asignar</option>
                                            {professionals.map((prof) => (
                                                <option key={prof.member_id} value={prof.member_id}>
                                                    {prof.first_name || ''} {prof.last_name || ''} {prof.job_title ? `(${prof.job_title})` : ''}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40 rotate-90 pointer-events-none" />
                                    </div>
                                    {newAppointment.professional_id && (
                                        <div className="mt-1.5 flex items-center gap-2">
                                            {(() => {
                                                const prof = professionals.find(p => p.member_id === newAppointment.professional_id)
                                                return prof ? (
                                                    <>
                                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: prof.color || '#8B5CF6' }} />
                                                        <span className="text-xs text-charcoal/60">
                                                            {prof.job_title || prof.specialty || prof.role}
                                                        </span>
                                                    </>
                                                ) : null
                                            })()}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="block text-sm font-medium text-charcoal">
                                                Dirección
                                            </label>
                                            {newAppointment.address && (
                                                <a 
                                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(newAppointment.address)}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
                                                >
                                                    <ExternalLink className="w-3 h-3" />
                                                    Ver en Maps
                                                </a>
                                            )}
                                        </div>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={newAppointment.address || ''}
                                                onChange={(e) => setNewAppointment({ ...newAppointment, address: e.target.value })}
                                                placeholder="Ej: Calle 123, Talca"
                                                className="input-soft w-full pl-10"
                                            />
                                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">
                                            Referencias de Ubicación
                                        </label>
                                        <input
                                            type="text"
                                            value={newAppointment.address_references || ''}
                                            onChange={(e) => setNewAppointment({ ...newAppointment, address_references: e.target.value })}
                                            placeholder="Ej: Portón verde, frente al parque"
                                            className="input-soft w-full"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">
                                            Fecha *
                                        </label>
                                        <input
                                            type="date"
                                            value={newAppointment.appointment_date}
                                            onChange={(e) => setNewAppointment({ ...newAppointment, appointment_date: e.target.value })}
                                            className="input-soft w-full !px-2 sm:!px-4"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">
                                            Hora *
                                        </label>
                                        <div className="flex gap-2">
                                            <select
                                                className="input-soft w-full appearance-none text-center !px-1 sm:!px-4"
                                                value={(() => {
                                                    const [h] = newAppointment.appointment_time.split(':').map(Number)
                                                    if (h === 0) return 12
                                                    if (h > 12) return h - 12
                                                    return h || 12 // Default to 12 if empty/NaN? Actually value should be valid.
                                                })()}
                                                onChange={(e) => {
                                                    const [currentH, currentM] = newAppointment.appointment_time.split(':').map(Number)
                                                    // Determine current AM/PM
                                                    const isPM = currentH >= 12
                                                    let newH = parseInt(e.target.value)

                                                    if (isPM && newH !== 12) newH += 12
                                                    if (!isPM && newH === 12) newH = 0

                                                    setNewAppointment({
                                                        ...newAppointment,
                                                        appointment_time: `${newH.toString().padStart(2, '0')}:${currentM.toString().padStart(2, '0')}`
                                                    })
                                                }}
                                            >
                                                {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                                                    <option key={h} value={h}>{h}</option>
                                                ))}
                                            </select>
                                            <select
                                                className="input-soft w-full appearance-none text-center !px-1 sm:!px-4"
                                                value={newAppointment.appointment_time.split(':')[1]}
                                                onChange={(e) => {
                                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                                    const [currentH, _] = newAppointment.appointment_time.split(':').map(Number)
                                                    // Handle NaN minutes if initialization failed

                                                    setNewAppointment({
                                                        ...newAppointment,
                                                        appointment_time: `${currentH.toString().padStart(2, '0')}:${e.target.value}`
                                                    })
                                                }}
                                            >
                                                {['00', '15', '30', '45'].map(m => (
                                                    <option key={m} value={m}>{m}</option>
                                                ))}
                                            </select>
                                            <select
                                                className="input-soft w-[65px] sm:w-[80px] appearance-none text-center bg-primary-50 font-medium text-primary-700 border-primary-200 !px-1 sm:!px-4"
                                                value={parseInt(newAppointment.appointment_time.split(':')[0]) >= 12 ? 'PM' : 'AM'}
                                                onChange={(e) => {
                                                    const [currentH, currentM] = newAppointment.appointment_time.split(':').map(Number)
                                                    const newIsPM = e.target.value === 'PM'
                                                    let newH = currentH

                                                    if (newIsPM && currentH < 12) newH += 12
                                                    if (!newIsPM && currentH >= 12) newH -= 12

                                                    setNewAppointment({
                                                        ...newAppointment,
                                                        appointment_time: `${newH.toString().padStart(2, '0')}:${currentM.toString().padStart(2, '0')}`
                                                    })
                                                }}
                                            >
                                                <option value="AM">AM</option>
                                                <option value="PM">PM</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-2">
                                        Notas (opcional)
                                    </label>
                                    <textarea
                                        value={newAppointment.notes}
                                        onChange={(e) => setNewAppointment({ ...newAppointment, notes: e.target.value })}
                                        placeholder="Notas adicionales..."
                                        rows={3}
                                        className="input-soft w-full resize-none"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-6 p-6 border-t border-silk-beige flex-shrink-0 bg-white rounded-b-soft overflow-hidden">
                                {editingId && (
                                    <div className="flex items-center justify-between border-b border-charcoal/5 pb-4">
                                        <button
                                            onClick={() => {
                                                const appt = appointments.find(a => a.id === editingId)
                                                if (appt && confirm('¿Estás SEGURO de que quieres ELIMINAR permanentemente esta cita del sistema?')) {
                                                    handleDeleteAppointment(appt)
                                                    setShowModal(false)
                                                }
                                            }}
                                            className="text-xs text-red-600 hover:text-red-700 font-bold flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 rounded-lg transition-all ring-1 ring-red-200"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            Eliminar Cita
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (confirm('¿Quieres marcar esta cita como CANCELADA (la cita se mantendrá en registros pero no en el calendario)?')) {
                                                    updateAppointmentStatus(editingId, 'cancelled')
                                                    setShowModal(false)
                                                }
                                            }}
                                            className="text-xs text-charcoal/50 hover:text-charcoal font-medium underline underline-offset-4 decoration-charcoal/20"
                                        >
                                            Sólo Cancelar
                                        </button>
                                    </div>
                                )}
                                
                                <div className="flex gap-3 w-full sm:justify-end">
                                    <button
                                        onClick={() => {
                                            setShowModal(false)
                                            setEditingId(null)
                                            setNewAppointment(INITIAL_FORM_STATE)
                                        }}
                                        className="btn-ghost flex-1 sm:flex-initial text-sm px-6"
                                    >
                                        Cerrar
                                    </button>
                                    <button
                                        onClick={handleSaveAppointment}
                                        disabled={saving || !newAppointment.tutor_name || !newAppointment.phone_number || !newAppointment.service || !newAppointment.appointment_date || !newAppointment.appointment_time}
                                        className="btn-primary flex-1 sm:px-8 flex items-center justify-center gap-2 text-sm whitespace-nowrap min-w-[160px]"
                                    >
                                        {saving ? (
                                            <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                        ) : (
                                            <><Plus className="w-4 h-4" /> {editingId ? 'Guardar Cambios' : 'Crear Cita'}</>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )
            }
        </div >
    )
}
