import { useState, useEffect } from 'react'
import {
    Plus,
    Search,
    Edit2,
    User as UserIcon,
    Phone,
    Trash2,
    X,
    Filter,
    Tag
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Users } from 'lucide-react'

import { TutorForm } from '@/components/patients/TutorForm'
import { TutorDetails } from '@/components/patients/TutorDetails'
import { SubscriptionGuard } from '@/components/auth/SubscriptionGuard'
import { TutorRowSkeleton, TutorCardSkeleton } from '@/components/ui/Skeleton'
import { CSVUploader } from '@/components/patients/CSVUploader'
import { cn } from '@/lib/utils'

type Contact = {
    id: string
    name: string | null
    phone_number: string | null
    email: string | null
    type: 'tutor' | 'prospect'
    notes: string | null
    created_at: string
    tags: { id: string; name: string; color: string }[]
    total_appointments?: number
}

interface TagSummary {
    tag_name: string
    tag_color: string
    contact_count: number
}

export default function Tutors() {
    const { profile } = useAuth()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [contacts, setContacts] = useState<Contact[]>([])
    const [showTagSidebar, setShowTagSidebar] = useState(false)
    const [editingTutor, setEditingTutor] = useState<any | null>(null)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
    const [tagSummaries, setTagSummaries] = useState<TagSummary[]>([])
    const [selectedTag, setSelectedTag] = useState<string | null>(null)

    // Modal states
    const [isFormOpen, setIsFormOpen] = useState(false)

    const fetchContacts = async () => {
        if (!profile?.clinic_id) return
        setLoading(true)
        setError(null)
        try {
            const { data, error: rpcError } = await (supabase as any).rpc('get_unified_contacts', {
                p_clinic_id: profile.clinic_id
            })

            if (rpcError) throw rpcError

            // Focus on tutors as CRM is no longer used
            const onlyTutors = (data || []).filter((c: any) => c.type === 'tutor')
            setContacts(onlyTutors)
        } catch (error: any) {
            console.error('Error fetching tutors:', error)
            setError(error.message || 'Error al cargar contactos')
        } finally {
            setLoading(false)
        }
    }

    const fetchTagSummaries = async () => {
        if (!profile?.clinic_id) return
        try {
            const { data, error: tagError } = await (supabase as any).rpc('get_tag_counts', {
                p_clinic_id: profile.clinic_id
            })
            if (!tagError) {
                setTagSummaries(data || [])
            }
        } catch (error) {
            console.error('Error fetching tag summaries:', error)
        }
    }

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchContacts()
            fetchTagSummaries()
        }, 500)
        return () => clearTimeout(timer)
    }, [searchQuery, profile?.clinic_id])

    const handleDelete = async (contact: Contact) => {
        if (!profile?.clinic_id) return

        try {
            const table = contact.type === 'tutor' ? 'tutors' : 'crm_prospects'
            const { error: deleteError } = await supabase
                .from(table)
                .delete()
                .eq('id', contact.id)

            if (deleteError) throw deleteError
            fetchContacts()
            setShowDeleteConfirm(null)
        } catch (error: any) {
            console.error('Error deleting contact:', error)
            alert('Error al eliminar contacto: ' + error.message)
        }
    }

    const filteredContacts = contacts.filter(c => {
        const matchesSearch =
            !searchQuery ||
            c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.phone_number?.includes(searchQuery) ||
            c.email?.toLowerCase().includes(searchQuery.toLowerCase())

        const matchesTag = !selectedTag || c.tags?.some(t => t.name === selectedTag)

        return matchesSearch && matchesTag
    })

    return (
        <SubscriptionGuard>
            {selectedContact ? (
                <TutorDetails
                    tutor={selectedContact as any}
                    onBack={() => setSelectedContact(null)}
                    onUpdate={fetchContacts}
                />
            ) : (
                <div className="space-y-6 animate-fade-in relative min-h-screen pb-20">
                    {/* Header Banner */}
                    <div className="bg-hero-gradient rounded-3xl p-8 sm:p-10 text-white relative overflow-hidden shadow-2xl mb-10 border border-white/10">
                        {/* Decorative blobs */}
                        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none animate-pulse"></div>
                        <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary-400/20 rounded-full blur-2xl translate-y-1/3 -translate-x-1/4 pointer-events-none"></div>

                        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
                            <div className="flex items-center gap-6">
                                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner group transition-all duration-500 hover:scale-110">
                                    <div className="p-3 bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-600 rounded-xl shadow-lg">
                                        <Users className="w-8 h-8 sm:w-10 sm:h-10 text-white drop-shadow-md" />
                                    </div>
                                </div>
                                <div>
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-[12px] font-bold uppercase tracking-widest mb-3 animate-fade-in">
                                        <Tag className="w-3.5 h-3.5 text-amber-300" />
                                        <span className="text-amber-50">Base de Contactos</span>
                                    </div>
                                    <h1 className="text-2xl sm:text-3xl font-black mb-2 tracking-tight drop-shadow-sm uppercase text-white">
                                        Tutores y Prospectos
                                    </h1>
                                    <p className="text-emerald-50/90 text-sm sm:text-base max-w-xl font-semibold leading-relaxed">
                                        Gestiona dueños de mascotas y leads potenciales en un solo lugar. Segmenta y fideliza a tu comunidad veterinaria.
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row items-center gap-3">
                                <CSVUploader onSuccess={fetchContacts} />
                                <button
                                    onClick={() => {
                                        setEditingTutor(null)
                                        setIsFormOpen(true)
                                    }}
                                    className="w-full sm:w-auto px-8 py-3.5 bg-white text-emerald-900 hover:bg-emerald-50 transition-all font-black rounded-xl flex items-center justify-center gap-2 shadow-premium hover:scale-105 active:scale-95 uppercase text-xs tracking-widest mt-2 sm:mt-0"
                                >
                                    <Plus className="w-5 h-5" />
                                    Nuevo Tutor
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-1 bg-silk-beige/30 p-1 rounded-lg w-fit">
                        <div className="px-4 py-2 text-sm font-bold text-primary-700 bg-white rounded-md shadow-sm uppercase tracking-widest">
                            Lista de Tutores
                        </div>
                    </div>

                    <div className="flex gap-6 relative">
                        {/* Main Content */}
                        <div className="flex-1 space-y-6">
                            {/* Filters Bar */}
                            <div className="flex gap-3">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal/40" />
                                    <input
                                        type="text"
                                        placeholder="Buscar por nombre, teléfono o email..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="input-soft pl-10 w-full"
                                    />
                                </div>
                                <button
                                    onClick={() => setShowTagSidebar(!showTagSidebar)}
                                    className={cn(
                                        "btn-ghost flex items-center gap-2 px-4 whitespace-nowrap",
                                        showTagSidebar || selectedTag ? "bg-primary-50 text-primary-700 border-primary-200" : ""
                                    )}
                                >
                                    <Filter className="w-4 h-4" />
                                    <span>Etiquetas</span>
                                    {selectedTag && (
                                        <span className="w-2 h-2 bg-primary-500 rounded-full" />
                                    )}
                                </button>
                            </div>

                            {/* Table (Desktop) */}
                            <div className="card-soft overflow-hidden hidden md:block">
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-silk-beige bg-ivory">
                                                <th className="text-left py-4 px-6 text-xs font-semibold text-charcoal/60 uppercase tracking-wider">Tutor / Prospecto</th>
                                                <th className="text-left py-4 px-6 text-xs font-semibold text-charcoal/60 uppercase tracking-wider">Tipo</th>
                                                <th className="text-left py-4 px-6 text-xs font-semibold text-charcoal/60 uppercase tracking-wider">Etiquetas</th>
                                                <th className="text-right py-4 px-6 text-xs font-semibold text-charcoal/60 uppercase tracking-wider">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-silk-beige">
                                            {loading ? (
                                                <>
                                                    <TutorRowSkeleton />
                                                    <TutorRowSkeleton />
                                                    <TutorRowSkeleton />
                                                    <TutorRowSkeleton />
                                                    <TutorRowSkeleton />
                                                </>
                                            ) : error ? (
                                                <tr>
                                                    <td colSpan={4} className="py-20 text-center text-red-500">
                                                        <div className="flex flex-col items-center gap-2">
                                                            <p>Error: {error}</p>
                                                            <button onClick={() => fetchContacts()} className="text-sm underline">Reintentar</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ) : filteredContacts.length === 0 ? (
                                                <tr>
                                                    <td colSpan={4} className="py-20 text-center text-charcoal/50">
                                                        {searchQuery ? 'No se encontraron resultados' : 'No hay tutores registrados aún'}
                                                    </td>
                                                </tr>
                                            ) : (
                                                filteredContacts.map((contact) => (
                                                    <tr
                                                        key={contact.id}
                                                        className={cn(
                                                            "transition-colors group hover:bg-silk-beige/30 cursor-pointer",
                                                            contact.type === 'prospect' && "opacity-90"
                                                        )}
                                                        onClick={() => setSelectedContact(contact)}
                                                    >
                                                        <td className="py-4 px-6">
                                                            <div className="flex items-center gap-3">
                                                                <div className={cn(
                                                                    "w-10 h-10 rounded-full flex items-center justify-center font-medium group-hover:scale-105 transition-transform",
                                                                    contact.type === 'tutor' ? "bg-primary-100 text-primary-700" : "bg-blue-100 text-blue-700"
                                                                )}>
                                                                    {contact.name?.charAt(0).toUpperCase() || <UserIcon className="w-5 h-5" />}
                                                                </div>
                                                                <div>
                                                                    <p className="font-medium text-charcoal group-hover:text-primary-700 transition-colors uppercase text-xs tracking-wide">
                                                                        {contact.name || 'Sin nombre'}
                                                                    </p>
                                                                    <div className="flex items-center gap-2 text-xs text-charcoal/40">
                                                                        <Phone className="w-3 h-3" /> {contact.phone_number || 'N/A'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="py-4 px-6">
                                                            <span className={cn(
                                                                "px-2 py-1 rounded-full text-xs font-bold font-bold uppercase tracking-wider",
                                                                contact.type === 'tutor' ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : "bg-blue-100 text-blue-700 border border-blue-200"
                                                            )}>
                                                                {contact.type === 'tutor' ? 'Tutor' : 'Prospecto'}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 px-6">
                                                            <div className="flex flex-wrap gap-1 max-w-[250px]">
                                                                {contact.tags?.map((tag, idx) => (
                                                                    <span
                                                                        key={idx}
                                                                        className="px-1.5 py-0.5 rounded text-xs font-bold font-medium border"
                                                                        style={{
                                                                            backgroundColor: `${tag.color}20`,
                                                                            color: tag.color,
                                                                            borderColor: `${tag.color}40`
                                                                        }}
                                                                    >
                                                                        {tag.name}
                                                                    </span>
                                                                ))}
                                                                {(!contact.tags || contact.tags.length === 0) && (
                                                                    <span className="text-xs text-charcoal/30">Sin etiquetas</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="py-4 px-6 text-right">
                                                            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                                                {contact.type === 'tutor' && (
                                                                    <button
                                                                        onClick={() => {
                                                                            setEditingTutor(contact)
                                                                            setIsFormOpen(true)
                                                                        }}
                                                                        className="p-2 hover:bg-primary-50 text-charcoal/60 hover:text-primary-600 rounded-soft transition-colors"
                                                                    >
                                                                        <Edit2 className="w-4 h-4" />
                                                                    </button>
                                                                )}
                                                                {showDeleteConfirm === contact.id ? (
                                                                    <div className="flex items-center gap-2 bg-red-50 p-1 rounded-soft">
                                                                        <button
                                                                            onClick={() => handleDelete(contact)}
                                                                            className="px-2 py-1 bg-red-500 text-white text-xs rounded"
                                                                        >ok</button>
                                                                        <button onClick={() => setShowDeleteConfirm(null)}><X className="w-3 h-3 text-red-500" /></button>
                                                                    </div>
                                                                ) : (
                                                                    <button onClick={() => setShowDeleteConfirm(contact.id)} className="p-2 hover:bg-red-50 text-charcoal/60 hover:text-red-500 rounded-soft">
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Mobile List View */}
                            <div className="md:hidden space-y-4">
                                {loading ? (
                                    <>
                                        <TutorCardSkeleton />
                                        <TutorCardSkeleton />
                                    </>
                                ) : error ? (
                                    <div className="py-20 text-center bg-white rounded-2xl border border-silk-beige text-red-500 px-4">
                                        <p className="mb-2 text-sm">Error: {error}</p>
                                        <button onClick={() => fetchContacts()} className="text-xs underline bg-red-50 px-3 py-1 rounded-full">Reintentar</button>
                                    </div>
                                ) : filteredContacts.length === 0 ? (
                                    <div className="py-20 text-center text-charcoal/50 bg-white rounded-2xl border border-silk-beige">
                                        {searchQuery ? 'No se encontraron resultados' : 'No hay contactos registrados aún'}
                                    </div>
                                ) : (
                                    filteredContacts.map((contact) => (
                                        <div
                                            key={`mob-${contact.id}`}
                                            className="bg-white rounded-2xl p-4 shadow-sm border border-silk-beige flex flex-col gap-3 active:scale-[0.98] transition-all"
                                            onClick={() => setSelectedContact(contact)}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className={cn(
                                                        "w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center font-medium",
                                                        contact.type === 'tutor' ? "bg-primary-100 text-primary-700" : "bg-blue-100 text-blue-700"
                                                    )}>
                                                        {contact.name?.charAt(0).toUpperCase() || <UserIcon className="w-5 h-5" />}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-charcoal truncate text-sm uppercase">{contact.name || 'Sin nombre'}</p>
                                                        <p className="text-xs font-bold text-charcoal/40 flex items-center gap-1 mt-0.5">
                                                            <Phone className="w-3 h-3" /> {contact.phone_number || 'N/A'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider flex-shrink-0 border",
                                                    contact.type === 'tutor' ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-blue-50 text-blue-700 border-blue-100"
                                                )}>
                                                    {contact.type === 'tutor' ? 'Tutor' : 'Prospecto'}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between gap-2 pt-2 border-t border-silk-beige/30">
                                                <div className="flex flex-wrap gap-1">
                                                    {contact.tags?.slice(0, 3).map((tag, idx) => (
                                                        <span
                                                            key={idx}
                                                            className="px-1.5 py-0.5 rounded text-[8px] font-bold border uppercase"
                                                            style={{
                                                                backgroundColor: `${tag.color}10`,
                                                                color: tag.color,
                                                                borderColor: `${tag.color}30`
                                                            }}
                                                        >
                                                            {tag.name}
                                                        </span>
                                                    ))}
                                                    {contact.tags?.length > 3 && (
                                                        <span className="text-[9px] text-charcoal/40 font-medium">+{contact.tags.length - 3}</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                    {contact.type === 'tutor' && (
                                                        <button
                                                            onClick={() => {
                                                                setEditingTutor(contact)
                                                                setIsFormOpen(true)
                                                            }}
                                                            className="p-1.5 text-charcoal/40 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => setShowDeleteConfirm(contact.id)}
                                                        className="p-1.5 text-charcoal/40 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Collapsible Tag Sidebar */}
                        {showTagSidebar && (
                            <div className="w-72 bg-white border border-silk-beige rounded-soft h-fit animate-slide-in-right sticky top-6 self-start shadow-soft-lg">
                                <div className="p-4 border-b border-silk-beige flex items-center justify-between">
                                    <h3 className="font-bold text-charcoal text-sm uppercase tracking-wider">Etiquetas</h3>
                                    <button onClick={() => setShowTagSidebar(false)} className="text-charcoal/40 hover:text-charcoal">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="p-4 space-y-1 max-h-[70vh] overflow-y-auto">
                                    <button
                                        onClick={() => setSelectedTag(null)}
                                        className={cn(
                                            "w-full text-left px-3 py-2 rounded-soft text-sm transition-colors flex justify-between items-center",
                                            !selectedTag ? "bg-primary-50 text-primary-700 font-medium" : "hover:bg-ivory text-charcoal/60"
                                        )}
                                    >
                                        <span>Todos los contactos</span>
                                        <span className="text-xs font-bold bg-white px-1.5 py-0.5 rounded border border-silk-beige">{contacts.length}</span>
                                    </button>
                                    <div className="pt-2 pb-1 text-xs font-bold font-bold text-charcoal/30 uppercase tracking-widest px-3">Segmentos</div>
                                    {tagSummaries.map(summary => (
                                        <button
                                            key={summary.tag_name}
                                            onClick={() => setSelectedTag(summary.tag_name === selectedTag ? null : summary.tag_name)}
                                            className={cn(
                                                "w-full text-left px-3 py-2 rounded-soft text-sm transition-colors flex justify-between items-center group",
                                                selectedTag === summary.tag_name ? "bg-primary-50 text-primary-700 font-medium" : "hover:bg-ivory text-charcoal/60"
                                            )}
                                        >
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: summary.tag_color }} />
                                                <span className="truncate">{summary.tag_name}</span>
                                            </div>
                                            <span className="text-xs font-bold bg-white px-1.5 py-0.5 rounded border border-silk-beige font-semibold">
                                                {summary.contact_count}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {isFormOpen && (
                <TutorForm
                    tutor={editingTutor}
                    onClose={() => setIsFormOpen(false)}
                    onSave={() => fetchContacts()}
                />
            )}
        </SubscriptionGuard>
    )
}
