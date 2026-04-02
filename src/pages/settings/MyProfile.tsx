import { useState, useEffect } from 'react'
import { Save, Loader2, Palette, Briefcase, Clock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { teamService } from '@/services/teamService'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'
import { cn } from '@/lib/utils'

const DAYS = [
    { key: 'monday', label: 'Lunes' },
    { key: 'tuesday', label: 'Martes' },
    { key: 'wednesday', label: 'Miércoles' },
    { key: 'thursday', label: 'Jueves' },
    { key: 'friday', label: 'Viernes' },
    { key: 'saturday', label: 'Sábado' },
    { key: 'sunday', label: 'Domingo' },
]

const COLOR_PRESETS = [
    '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
    '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
]

const DEFAULT_HOURS = {
    monday: { enabled: true, start: '09:00', end: '18:00', lunch_break: { enabled: false, start: '14:00', end: '15:00' } },
    tuesday: { enabled: true, start: '09:00', end: '18:00', lunch_break: { enabled: false, start: '14:00', end: '15:00' } },
    wednesday: { enabled: true, start: '09:00', end: '18:00', lunch_break: { enabled: false, start: '14:00', end: '15:00' } },
    thursday: { enabled: true, start: '09:00', end: '18:00', lunch_break: { enabled: false, start: '14:00', end: '15:00' } },
    friday: { enabled: true, start: '09:00', end: '18:00', lunch_break: { enabled: false, start: '14:00', end: '15:00' } },
    saturday: { enabled: false, start: '09:00', end: '13:00', lunch_break: { enabled: false, start: '14:00', end: '15:00' } },
    sunday: { enabled: false, start: '09:00', end: '13:00', lunch_break: { enabled: false, start: '14:00', end: '15:00' } },
}

export default function MyProfile() {
    const { user, member, profile } = useAuth()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    // const [jobTitle, setJobTitle] = useState('') // Removed redundant state
    const [specialty, setSpecialty] = useState('')
    const [color, setColor] = useState('#8B5CF6')
    const [workingHours, setWorkingHours] = useState<Record<string, { enabled: boolean; start: string; end: string; lunch_break?: { enabled: boolean; start: string; end: string } }>>(DEFAULT_HOURS)

    // Derived role string with extremely robust detection
    const getSystemRole = () => {
        const r = (member?.role || profile?.role || '').toLowerCase()
        if (r.includes('owner') || r.includes('dueño') || r.includes('admin')) return 'Administrador'
        if (r.includes('professional') || r.includes('profesional') || r.includes('médico')) return 'Profesional'
        if (r.includes('receptionist') || r.includes('recepción') || r.includes('secretaria')) return 'Recepcionista'
        return 'Miembro del equipo'
    }

    const systemRoleString = getSystemRole()

    useEffect(() => {
        if (member) {
            setFirstName(member.first_name || '')
            setLastName(member.last_name || '')
            setSpecialty(member.specialty || '')
            setColor(member.color || '#8B5CF6')
            setWorkingHours((member as any).working_hours || DEFAULT_HOURS)
        } else if (profile) {
            const names = profile.full_name?.split(' ') || []
            setFirstName(names[0] || '')
            setLastName(names.slice(1).join(' ') || '')
        }
        setLoading(false)

        // KILL BROWSER AUTOFILL: If we detect an email in specialty on mount, clear it
        // This is a last-resort defense against aggressive browser autofill
        const timeout = setTimeout(() => {
            setSpecialty(prev => (prev && prev.includes('@')) ? '' : prev)
        }, 500)
        return () => clearTimeout(timeout)
    }, [member, profile])

    const handleSave = async () => {
        let currentMemberId = member?.id

        if (!currentMemberId) {
            console.warn('Member ID not found, attempting repair...')
            
            if (!user || !profile?.clinic_id) {
                toast.error('Sesión no identificada. Refresca la página.')
                return
            }

            // 1. Intentar insertar el registro (si no existe)
            // Usamos (supabase as any) para evitar errores de tipo 'never' en el build de Vercel
            const { data: repairData, error: repairError } = await (supabase as any)
                .from('clinic_members')
                .insert({
                    clinic_id: profile.clinic_id,
                    user_id: user.id,
                    email: user.email!,
                    first_name: firstName,
                    last_name: lastName,
                    role: 'owner',
                    status: 'active'
                })
                .select()
                .single()

            if (repairError) {
                // 2. Si el error es por duplicado (code 23505), intentar vincular el existente
                if (repairError.code === '23505') {
                    console.log('Record exists, linking account...')
                    const { data: linkedData, error: linkError } = await (supabase as any)
                        .from('clinic_members')
                        .update({ user_id: user.id, status: 'active' })
                        .eq('clinic_id', profile.clinic_id)
                        .eq('email', user.email!)
                        .select()
                        .single()
                    
                    if (linkError) {
                        toast.error('Error al vincular: ' + linkError.message)
                        return
                    }
                    currentMemberId = linkedData.id
                } else {
                    console.error('Repair failed:', repairError)
                    toast.error(`Error DB: ${repairError.message}. Ejecuta el Script Maestro.`)
                    return
                }
            } else if (repairData) {
                currentMemberId = repairData.id
            }
        }

        if (!currentMemberId) {
            toast.error('No se pudo identificar tu perfil profesional.')
            return
        }

        setSaving(true)
        try {
            await teamService.updateMemberProfile(currentMemberId, {
                first_name: firstName,
                last_name: lastName,
                job_title: systemRoleString, // Send the derived role string to DB
                specialty,
                color,
                working_hours: workingHours,
            })
            toast.success('Perfil actualizado correctamente')
        } catch (error: any) {
            console.error('Error updating profile:', error)
            
            // SECONDARY RETRY: If columns 'color' or 'working_hours' are missing (PGRST204), try save without them
            if (error?.code === 'PGRST204' || error?.message?.includes('color') || error?.message?.includes('working_hours')) {
                console.warn('Database schema missing new columns, retrying basic save...')
                try {
                    await teamService.updateMemberProfile(currentMemberId, {
                        first_name: firstName,
                        last_name: lastName,
                        job_title: systemRoleString,
                        specialty,
                    })
                    toast.success('Perfil guardado (sin horarios ni color)')
                    toast('Dato: Tu base de datos necesita una actualización de esquema.', { icon: '⚠️' })
                } catch (retryError: any) {
                    toast.error('Error al actualizar el perfil básico.')
                }
            } else if (error?.message?.includes('permission denied') || error?.code === '42501') {
                toast.error('No tienes permisos suficientes para actualizar este perfil.')
            } else {
                toast.error('Error al actualizar el perfil. Intenta de nuevo.')
            }
        } finally {
            setSaving(false)
        }
    }

    const updateDay = (dayKey: string, field: string, value: any) => {
        setWorkingHours(prev => ({
            ...prev,
            [dayKey]: {
                ...prev[dayKey],
                [field]: value
            }
        }))
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fade-in max-w-3xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-charcoal">Mi Perfil Profesional</h1>
                    <p className="text-charcoal/50 mt-1">Configura tu información y horarios de atención</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="btn-primary flex items-center gap-2"
                >
                    {saving ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                    ) : (
                        <><Save className="w-4 h-4" /> Guardar Cambios</>
                    )}
                </button>
            </div>

            {/* Información Personal */}
            <div className="card-soft p-6">
                <h2 className="text-base font-semibold text-charcoal mb-4 flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-primary-500" />
                    Información Profesional
                </h2>
                <div className="bg-white rounded-xl border border-charcoal/10 p-6 space-y-6">
                {/* 
                  POISON PILL FOR AUTOFILL:
                  Many browsers (Chrome, Safari) ignore autocomplete="off" and try to find name/email fields.
                  We add hidden fields at the top to "trap" the autofill here.
                */}
                <div className="sr-only" aria-hidden="true" style={{ position: 'absolute', top: -1000, left: -1000 }}>
                    <input type="text" name="fake-username" tabIndex={-1} />
                    <input type="email" name="fake-email" tabIndex={-1} />
                    <input type="password" name="fake-password" tabIndex={-1} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-2">
                        <label className="block text-sm font-medium text-charcoal/70 mb-1.5">Nombre</label>
                        <input
                            type="text"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            className="input-soft w-full"
                            placeholder="Tu nombre"
                            autoComplete="new-password" // Stronger signal to disable autofill
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="block text-sm font-medium text-charcoal/70 mb-1.5">Apellido</label>
                        <input
                            type="text"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            className="input-soft w-full"
                            placeholder="Tu apellido"
                            autoComplete="new-password"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-charcoal/70 mb-1.5">Cargo</label>
                        <input
                            type="text"
                            value={systemRoleString} // Correctly using the derived string!
                            readOnly
                            className="input-soft w-full bg-charcoal/5 cursor-not-allowed opacity-70"
                        />
                        <p className="text-[10px] text-charcoal/40 mt-1 italic">
                            Dato gestionado por el sistema 
                            ({member?.role ? `Rol Miembro: ${member.role}` : `Rol Perfil: ${profile?.role || 'Buscando...'}`})
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-charcoal/70 mb-1.5">Especialidad</label>
                        <input
                            type="text"
                            value={specialty}
                            onChange={(e) => setSpecialty(e.target.value)}
                            className="input-soft w-full"
                            placeholder="Ej: Ortodoncia, Rehabilitación"
                            autoComplete="new-password"
                            name={`specialty_field_${Math.random().toString(36).substring(7)}`} // Dynamic name to confuse autofill
                        />
                    </div>
                </div>
            </div>
        </div>

            {/* Color del Calendario */}
            <div className="card-soft p-6">
                <h2 className="text-base font-semibold text-charcoal mb-4 flex items-center gap-2">
                    <Palette className="w-4 h-4 text-primary-500" />
                    Color del Calendario
                </h2>
                <p className="text-sm text-charcoal/50 mb-4">
                    Este color se usará para identificar tus citas en el calendario compartido.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                    {COLOR_PRESETS.map((c) => (
                        <button
                            key={c}
                            onClick={() => setColor(c)}
                            className={cn(
                                "w-9 h-9 rounded-full transition-all duration-200 ring-offset-2 flex-shrink-0",
                                color === c ? "ring-2 ring-primary-500 scale-110" : "hover:scale-105"
                            )}
                            style={{ backgroundColor: c }}
                        />
                    ))}
                    <div className="ml-2 flex items-center gap-2 sm:ml-2">
                        <input
                            type="color"
                            value={color}
                            onChange={(e) => setColor(e.target.value)}
                            className="w-9 h-9 rounded-full cursor-pointer border-2 border-silk-beige flex-shrink-0"
                        />
                        <span className="text-xs text-charcoal/40 font-mono">{color}</span>
                    </div>
                </div>
                {/* Preview */}
                <div className="mt-4 p-3 rounded-lg border-l-4 text-sm" style={{
                    borderLeftColor: color,
                    backgroundColor: color + '15'
                }}>
                    <div className="font-medium text-charcoal">Paciente Ejemplo - Servicio de prueba</div>
                    <div className="text-xs text-charcoal/60 mt-0.5">10:00 AM - 11:00 AM</div>
                </div>
            </div>

            {/* Horarios de Atención */}
            <div className="card-soft p-6">
                <h2 className="text-base font-semibold text-charcoal mb-4 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary-500" />
                    Horarios de Atención
                </h2>
                <p className="text-sm text-charcoal/50 mb-4">
                    Configura los días y horas en los que atiendes pacientes. El agente IA respetará estos horarios al agendar citas.
                </p>
                <div className="space-y-3">
                    {DAYS.map((day) => {
                        const dayHours = workingHours[day.key] || { enabled: false, start: '09:00', end: '18:00' }
                        return (
                            <div
                                key={day.key}
                                className={cn(
                                    "flex flex-wrap items-center gap-3 sm:gap-4 p-3 rounded-lg transition-colors",
                                    dayHours.enabled ? "bg-ivory" : "bg-gray-50/70"
                                )}
                            >
                                <label className="flex items-center gap-3 w-28 sm:w-32 cursor-pointer flex-shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={dayHours.enabled}
                                        onChange={(e) => updateDay(day.key, 'enabled', e.target.checked)}
                                        className="accent-primary-500 w-4 h-4"
                                    />
                                    <span className={cn(
                                        "text-sm font-medium",
                                        dayHours.enabled ? "text-charcoal" : "text-charcoal/40"
                                    )}>
                                        {day.label}
                                    </span>
                                </label>
                                {dayHours.enabled && (
                                    <div className="flex flex-col gap-3 flex-1 min-w-[200px]">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="time"
                                                value={dayHours.start}
                                                onChange={(e) => updateDay(day.key, 'start', e.target.value)}
                                                className="input-soft text-sm py-1.5 px-2 sm:px-3 w-full flex-1"
                                            />
                                            <span className="text-charcoal/40 text-sm">a</span>
                                            <input
                                                type="time"
                                                value={dayHours.end}
                                                onChange={(e) => updateDay(day.key, 'end', e.target.value)}
                                                className="input-soft text-sm py-1.5 px-2 sm:px-3 w-full flex-1"
                                            />
                                        </div>

                                        {/* Colación UI */}
                                        <div className="flex flex-wrap items-center gap-4 pl-4 border-l-2 border-silk-beige/30 ml-1">
                                            <label className="flex items-center gap-2 cursor-pointer group">
                                                <div className="relative inline-flex items-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={dayHours.lunch_break?.enabled || false}
                                                        onChange={(e) => {
                                                            const checked = e.target.checked;
                                                            setWorkingHours((prev: any) => ({
                                                                ...prev,
                                                                [day.key]: {
                                                                    ...prev[day.key],
                                                                    lunch_break: {
                                                                        ...(prev[day.key].lunch_break || { start: '14:00', end: '15:00' }),
                                                                        enabled: checked
                                                                    }
                                                                }
                                                            }))
                                                        }}
                                                        className="sr-only peer"
                                                    />
                                                    <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary-500"></div>
                                                </div>
                                                <span className="text-[11px] font-medium text-charcoal/40 group-hover:text-charcoal/60 transition-colors">Colación</span>
                                            </label>

                                            {dayHours.lunch_break?.enabled && (
                                                <div className="flex items-center gap-2 animate-fade-in">
                                                    <input
                                                        type="time"
                                                        value={dayHours.lunch_break.start}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            setWorkingHours((prev: any) => ({
                                                                ...prev,
                                                                [day.key]: {
                                                                    ...prev[day.key],
                                                                    lunch_break: { ...prev[day.key].lunch_break, start: val }
                                                                }
                                                            }))
                                                        }}
                                                        className="px-2 py-0.5 bg-white border border-silk-beige rounded-soft text-[11px] w-20"
                                                    />
                                                    <span className="text-charcoal/30 text-xs font-bold">a</span>
                                                    <input
                                                        type="time"
                                                        value={dayHours.lunch_break.end}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            setWorkingHours((prev: any) => ({
                                                                ...prev,
                                                                [day.key]: {
                                                                    ...prev[day.key],
                                                                    lunch_break: { ...prev[day.key].lunch_break, end: val }
                                                                }
                                                            }))
                                                        }}
                                                        className="px-2 py-0.5 bg-white border border-silk-beige rounded-soft text-[11px] w-20"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
