import { useState, useEffect } from 'react'
import { 
    X, 
    User, 
    Phone, 
    Mail, 
    Tag, 
    MessageSquare, 
    Bot, 
    UserCheck, 
    Loader2, 
    Save, 
    Plus,
    Calendar,
    Briefcase,
    Target,
    Clock
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface CrmTag {
    id: string
    name: string
    color: string
}

interface Prospect {
    id: string
    clinic_id: string
    name: string | null
    phone: string | null
    email: string | null
    address: string | null
    service_interest: string | null
    source: string | null
    notes: string | null
    requires_human: boolean
    created_at: string
    updated_at: string
}

interface ContactInfoSidebarProps {
    phoneNumber: string
    clinicId: string
    onClose: () => void
}

export function ContactInfoSidebar({ phoneNumber, clinicId, onClose }: ContactInfoSidebarProps) {
    const [loading, setLoading] = useState(true)
    const [prospect, setProspect] = useState<Prospect | null>(null)
    const [tags, setTags] = useState<CrmTag[]>([])
    const [allTags, setAllTags] = useState<CrmTag[]>([])
    const [saving, setSaving] = useState(false)
    const [showTagAdd, setShowTagAdd] = useState(false)
    const [newNote, setNewNote] = useState('')
    const [isEditingName, setIsEditingName] = useState(false)
    const [tempName, setTempName] = useState('')

    useEffect(() => {
        fetchProspectData()
    }, [phoneNumber, clinicId])

    const fetchProspectData = async () => {
        setLoading(true)
        try {
            // Normalize phone for lookup (matching webhook logic)
            const normalizedPhone = phoneNumber.replace(/\D/g, '')

            // Fetch prospect
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: prospectData, error: pError } = await (supabase as any)
                .from('crm_prospects')
                .select('*')
                .eq('clinic_id', clinicId)
                .or(`phone.eq.${normalizedPhone},phone.eq.+${normalizedPhone}`)
                .maybeSingle()

            if (pError) throw pError
            
            if (prospectData) {
                setProspect(prospectData)
                setTempName(prospectData.name || 'Sin nombre')
            } else {
                // Initialize virtual prospect for new contacts so UI stays interactive
                setProspect({
                    id: '', // Empty ID tells us it's not yet in DB
                    clinic_id: clinicId,
                    phone: phoneNumber,
                    name: 'Nuevo Contacto',
                    email: null,
                    address: null,
                    service_interest: null,
                    source: 'whatsapp',
                    notes: '',
                    requires_human: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                setTempName('Nuevo Contacto')
            }

            // Fetch patient (to check for older tags/status)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: patientData } = await (supabase as any)
                .from('patients')
                .select('id')
                .eq('clinic_id', clinicId)
                .or(`phone_number.eq.${normalizedPhone},phone_number.eq.+${normalizedPhone}`)
                .maybeSingle()

            const allAssignedTags: CrmTag[] = []

            if (prospectData) {
                // Fetch assigned CRM tags
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: crmTagData } = await (supabase as any)
                    .from('crm_prospect_tags')
                    .select('tag:crm_tags(*)')
                    .eq('prospect_id', prospectData.id)
                
                if (crmTagData) {
                    allAssignedTags.push(...crmTagData.map((t: any) => t.tag).filter(Boolean))
                }
            }

            if (patientData) {
                // Fetch assigned Patient tags
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: patientTagData } = await (supabase as any)
                    .from('patient_tags')
                    .select('tag:tags(*)')
                    .eq('patient_id', patientData.id)
                
                if (patientTagData) {
                    const mappedTags = patientTagData.map((t: any) => t.tag).filter(Boolean)
                    // Avoid duplicates by name
                    mappedTags.forEach((t: any) => {
                        if (!allAssignedTags.some(at => at.name.toLowerCase() === t.name.toLowerCase())) {
                            allAssignedTags.push(t)
                        }
                    })
                }
            }

            setTags(allAssignedTags)

            // Fetch all available tags for the clinic from BOTH systems
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [crmTagsRes, patientTagsRes] = await Promise.all([
                (supabase as any).from('crm_tags').select('*').eq('clinic_id', clinicId),
                (supabase as any).from('tags').select('*').eq('clinic_id', clinicId)
            ])
            
            const unifiedAvailableTags: CrmTag[] = [...(crmTagsRes.data || [])]
            if (patientTagsRes.data) {
                patientTagsRes.data.forEach((t: any) => {
                    if (!unifiedAvailableTags.some(at => at.name.toLowerCase() === t.name.toLowerCase())) {
                        unifiedAvailableTags.push(t)
                    }
                })
            }
            
            setAllTags(unifiedAvailableTags.sort((a, b) => a.name.localeCompare(b.name)))

        } catch (err) {
            console.error('Error fetching prospect info:', err)
        } finally {
            setLoading(false)
        }
    }

    const ensureProspectId = async (currentProspect: Prospect): Promise<string> => {
        if (currentProspect.id) return currentProspect.id
        
        // Create the prospect on the fly
        const { data, error } = await (supabase as any)
            .from('crm_prospects')
            .insert({
                clinic_id: clinicId,
                phone: phoneNumber,
                name: tempName || 'Nuevo Contacto',
                source: 'whatsapp'
            })
            .select('id')
            .single()
            
        if (error) throw error
        setProspect(prev => prev ? { ...prev, id: data.id } : null)
        return data.id
    }

    const saveName = async () => {
        if (!prospect || !tempName.trim()) return
        setSaving(true)
        try {
            const prospectId = await ensureProspectId(prospect)
            await (supabase as any)
                .from('crm_prospects')
                .update({ name: tempName.trim(), updated_at: new Date().toISOString() })
                .eq('id', prospectId)
            
            setProspect(prev => prev ? { ...prev, name: tempName.trim(), id: prospectId } : null)
            setIsEditingName(false)
        } catch (err) {
            console.error('Error saving name:', err)
            alert('Error al guardar el nombre.')
        } finally {
            setSaving(false)
        }
    }

    const toggleHumanRequirement = async () => {
        if (!prospect) return
        setSaving(true)
        try {
            const newValue = !prospect.requires_human
            const prospectId = await ensureProspectId(prospect)
            
            // Normalize phone for tutor update fallback
            const normalizedPhone = phoneNumber.replace(/\D/g, '')
            const searchPhone = normalizedPhone.startsWith("+") ? normalizedPhone : `+${normalizedPhone}`
            const searchPhoneNoPlus = normalizedPhone.startsWith("+") ? normalizedPhone.substring(1) : normalizedPhone

            // Update both tables for consistency
            await Promise.all([
                (supabase as any)
                    .from('crm_prospects')
                    .update({ requires_human: newValue, updated_at: new Date().toISOString() })
                    .eq('id', prospectId),
                (supabase as any)
                    .from('tutors')
                    .update({ requires_human: newValue, updated_at: new Date().toISOString() })
                    .eq('clinic_id', clinicId)
                    .or(`phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`)
            ])
            
            setProspect(prev => prev ? { ...prev, requires_human: newValue, id: prospectId } : null)
        } catch (err) {
            console.error('Error toggling human req:', err)
        } finally {
            setSaving(false)
        }
    }

    const addTag = async (tagId: string) => {
        if (!prospect) return
        try {
            const prospectId = await ensureProspectId(prospect)
            const tagToAdd = allTags.find(t => t.id === tagId)
            if (!tagToAdd) return

            // 1. Try to find if it's a CRM tag
            const { data: isCrmTag } = await (supabase as any)
                .from('crm_tags')
                .select('id')
                .eq('id', tagId)
                .maybeSingle()

            if (isCrmTag) {
                const { error } = await (supabase as any)
                    .from('crm_prospect_tags')
                    .insert({ prospect_id: prospectId, tag_id: tagId })
                if (error && error.code !== '23505') throw error
            } else {
                // 2. Try to find if it's a Patient tag
                const { data: isPatientTag } = await (supabase as any)
                    .from('tags')
                    .select('id')
                    .eq('id', tagId)
                    .maybeSingle()

                if (isPatientTag) {
                    // Find patient record
                    const normalizedPhone = phoneNumber.replace(/\D/g, '')
                    const { data: patient } = await (supabase as any)
                        .from('patients')
                        .select('id')
                        .eq('clinic_id', clinicId)
                        .or(`phone_number.eq.${normalizedPhone},phone_number.eq.+${normalizedPhone}`)
                        .maybeSingle()
                    
                    if (patient) {
                        const { error } = await (supabase as any)
                            .from('patient_tags')
                            .insert({ patient_id: patient.id, tag_id: tagId })
                        if (error && error.code !== '23505') throw error
                    } else {
                        // If no patient record, but it's a "patient" tag, we can't easily link it 
                        // unless we create a CRM tag with the same name.
                        console.warn('Cannot link patient-system tag to a non-patient prospect')
                    }
                }
            }
            
            if (!tags.some(t => t.id === tagId)) {
                setTags(prev => [...prev, tagToAdd])
            }
            setShowTagAdd(false)
        } catch (err) {
            console.error('Error adding tag:', err)
            alert('Error al agregar etiqueta.')
        }
    }

    const removeTag = async (tagId: string) => {
        try {
            // Remove from both systems (silent if not exists)
            if (prospect) {
                await (supabase as any)
                    .from('crm_prospect_tags')
                    .delete()
                    .eq('prospect_id', prospect.id)
                    .eq('tag_id', tagId)
            }

            const normalizedPhone = phoneNumber.replace(/\D/g, '')
            const { data: patient } = await (supabase as any)
                .from('patients')
                .select('id')
                .eq('clinic_id', clinicId)
                .or(`phone_number.eq.${normalizedPhone},phone_number.eq.+${normalizedPhone}`)
                .maybeSingle()
            
            if (patient) {
                await (supabase as any)
                    .from('patient_tags')
                    .delete()
                    .eq('patient_id', patient.id)
                    .eq('tag_id', tagId)
            }

            setTags(prev => prev.filter(t => t.id !== tagId))
        } catch (err) {
            console.error('Error removing tag:', err)
            alert('Error al eliminar etiqueta.')
        }
    }

    const saveNote = async () => {
        if (!prospect || !newNote.trim()) return
        setSaving(true)
        try {
            const prospectId = await ensureProspectId(prospect)
            const notes = prospect.notes ? `${prospect.notes}\n${newNote.trim()}` : newNote.trim()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('crm_prospects')
                .update({ notes, updated_at: new Date().toISOString() })
                .eq('id', prospectId)
            
            if (error) throw error
            setProspect(prev => prev ? { ...prev, notes, id: prospectId } : null)
            setNewNote('')
        } catch (err) {
            console.error('Error saving note:', err)
            alert('Error al guardar la nota.')
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="w-80 h-full bg-white border-l border-silk-beige flex flex-col animate-in slide-in-from-right duration-300">
                <div className="flex items-center justify-between p-4 border-b border-silk-beige">
                    <h2 className="font-bold text-charcoal">Información</h2>
                    <button onClick={onClose} className="p-2 hover:bg-ivory rounded-soft"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                </div>
            </div>
        )
    }

    if (!prospect && !loading) {
        return (
            <div className="w-80 h-full bg-white border-l border-silk-beige flex flex-col animate-in slide-in-from-right duration-300">
                <div className="flex items-center justify-between p-4 border-b border-silk-beige">
                    <h2 className="font-bold text-charcoal">Información</h2>
                    <button onClick={onClose} className="p-2 hover:bg-ivory rounded-soft"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-8 text-center">
                    <div className="w-16 h-16 bg-ivory rounded-full flex items-center justify-center mx-auto mb-4">
                        <User className="w-8 h-8 text-charcoal/20" />
                    </div>
                    <p className="text-charcoal/60">Cargando información...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="w-80 h-full bg-white border-l border-silk-beige flex flex-col animate-in slide-in-from-right duration-300 shadow-premium-lg">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-silk-beige bg-ivory/50">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-primary-600" />
                    </div>
                    <h2 className="font-bold text-charcoal">Contacto</h2>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-ivory rounded-full transition-colors flex items-center justify-center text-charcoal/40 hover:text-charcoal">
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="p-6 space-y-8">
                    {/* Basic Info */}
                    <section className="space-y-4">
                        <div className="text-center pb-6 border-b border-silk-beige/50 group relative">
                            {isEditingName ? (
                                <div className="flex items-center gap-2 mb-1">
                                    <input
                                        type="text"
                                        value={tempName}
                                        onChange={(e) => setTempName(e.target.value)}
                                        className="flex-1 px-3 py-1.5 text-sm border border-primary-200 rounded-soft focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                        autoFocus
                                    />
                                    <button 
                                        onClick={saveName}
                                        disabled={saving}
                                        className="p-1.5 bg-primary-500 text-white rounded-soft hover:bg-primary-600 disabled:opacity-50"
                                    >
                                        <Save className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <h3 
                                    className="text-xl font-bold text-charcoal mb-1 cursor-pointer hover:text-primary-600 transition-colors flex items-center justify-center gap-2 group"
                                    onClick={() => setIsEditingName(true)}
                                >
                                    {prospect?.name || 'Sin nombre'}
                                    <Plus className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </h3>
                            )}
                            <p className="text-sm text-charcoal/40 flex items-center justify-center gap-1.5">
                                <Phone className="w-3.5 h-3.5" /> {phoneNumber}
                            </p>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-silk-beige/30 rounded-soft mt-0.5">
                                    <Mail className="w-4 h-4 text-charcoal/60" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-charcoal/40 uppercase tracking-wider">Email</p>
                                    <p className="text-sm text-charcoal truncate">{prospect?.email || 'No proporcionado'}</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-silk-beige/30 rounded-soft mt-0.5">
                                    <Briefcase className="w-4 h-4 text-charcoal/60" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-charcoal/40 uppercase tracking-wider">Interés</p>
                                    <p className="text-sm text-charcoal">{prospect?.service_interest || 'Ninguno especificado'}</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-silk-beige/30 rounded-soft mt-0.5">
                                    <Target className="w-4 h-4 text-charcoal/60" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-charcoal/40 uppercase tracking-wider">Fuente</p>
                                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold font-bold bg-ivory border border-silk-beige text-charcoal/60 mt-1 capitalize">
                                        {prospect?.source || 'Directo'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* AI & Human Status */}
                    <section className="bg-silk-beige/10 rounded-soft p-4 border border-silk-beige/30 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Bot className={cn("w-5 h-5", prospect?.requires_human ? "text-charcoal/30" : "text-primary-500")} />
                                <span className="text-sm font-semibold text-charcoal">Respuesta IA</span>
                            </div>
                            <div className={cn(
                                "px-2 py-0.5 rounded-full text-xs font-bold font-bold uppercase",
                                prospect?.requires_human ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                            )}>
                                {prospect?.requires_human ? "Silenciada" : "Activa"}
                            </div>
                        </div>
                        <button 
                            onClick={toggleHumanRequirement}
                            disabled={saving}
                            className={cn(
                                "w-full py-2 px-4 rounded-soft text-xs font-bold transition-all flex items-center justify-center gap-2",
                                prospect?.requires_human 
                                    ? "bg-primary-500 text-white hover:bg-primary-600 shadow-md"
                                    : "bg-ivory border border-silk-beige text-charcoal hover:bg-white"
                            )}
                        >
                            {saving ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                            ) : prospect?.requires_human ? (
                                <>
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Reactivar IA
                                </>
                            ) : (
                                <>
                                    <UserCheck className="w-3.5 h-3.5" />
                                    Derivar a Humano
                                </>
                            )}
                        </button>
                    </section>

                    {/* Tags */}
                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-charcoal/40 uppercase tracking-wider flex items-center gap-1.5">
                                <Tag className="w-3.5 h-3.5" /> Etiquetas
                            </h4>
                            <button 
                                onClick={() => setShowTagAdd(!showTagAdd)}
                                className="p-1 hover:bg-ivory rounded transition-colors text-primary-500"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>

                        {showTagAdd && (
                            <div className="bg-ivory/50 rounded-soft border border-silk-beige p-2 animate-in fade-in zoom-in-95 duration-200">
                                <p className="text-xs font-bold font-bold text-charcoal/40 mb-2 px-1">Selecciona para agregar:</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {allTags.filter(at => !tags.some(t => t.id === at.id)).map(tag => (
                                        <button
                                            key={tag.id}
                                            onClick={() => addTag(tag.id)}
                                            className="text-xs font-bold px-2 py-1 rounded-full text-white font-medium hover:scale-105 transition-transform"
                                            style={{ backgroundColor: tag.color }}
                                        >
                                            {tag.name}
                                        </button>
                                    ))}
                                    {allTags.filter(at => !tags.some(t => t.id === at.id)).length === 0 && (
                                        <p className="text-xs font-bold text-charcoal/40 italic p-1">No hay más etiquetas</p>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                            {tags.map(tag => (
                                <div 
                                    key={tag.id}
                                    className="group relative flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full text-white font-semibold transition-all hover:pr-6 overflow-hidden"
                                    style={{ backgroundColor: tag.color }}
                                >
                                    {tag.name}
                                    <button 
                                        onClick={() => removeTag(tag.id)}
                                        className="absolute right-1 opacity-0 group-hover:opacity-100 hover:bg-black/10 rounded-full p-0.5 transition-opacity"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                            {tags.length === 0 && (
                                <p className="text-xs text-charcoal/30 italic">Sin etiquetas asignadas</p>
                            )}
                        </div>
                    </section>

                    {/* Notes */}
                    <section className="space-y-3">
                        <h4 className="text-xs font-bold text-charcoal/40 uppercase tracking-wider flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5" /> Notas Internas
                        </h4>
                        
                        <div className="space-y-3">
                            {prospect?.notes && (
                                <div className="bg-ivory rounded-soft p-3 text-xs text-charcoal/70 whitespace-pre-wrap border border-silk-beige/50">
                                    {prospect.notes}
                                </div>
                            )}
                            
                            <div className="space-y-2">
                                <textarea 
                                    value={newNote}
                                    onChange={(e) => setNewNote(e.target.value)}
                                    placeholder="Agregar una nota..."
                                    className="w-full h-20 text-xs p-3 rounded-soft border border-silk-beige focus:ring-1 focus:ring-primary-500 outline-none transition-shadow placeholder:text-charcoal/30"
                                />
                                <button 
                                    onClick={saveNote}
                                    disabled={saving || !newNote.trim()}
                                    className="btn-primary-sm w-full py-2 flex items-center justify-center gap-2 text-[11px]"
                                >
                                    <Save className="w-3.5 h-3.5" />
                                    Guardar Nota
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Meta Info */}
                    <section className="pt-4 border-t border-silk-beige/50 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-charcoal/30">
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Creado:</span>
                            <span>{prospect?.created_at ? new Date(prospect.created_at).toLocaleDateString() : '-'}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs font-bold text-charcoal/30">
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Último cambio:</span>
                            <span>{prospect?.updated_at ? new Date(prospect.updated_at).toLocaleDateString() : '-'}</span>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}

function Sparkles(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
            <path d="M5 3v4" />
            <path d="M19 17v4" />
            <path d="M3 5h4" />
            <path d="M17 19h4" />
        </svg>
    )
}
