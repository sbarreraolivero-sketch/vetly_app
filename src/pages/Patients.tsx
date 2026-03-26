import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
    Dog, 
    Search, 
    ChevronRight,
    Calendar,
    User
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { SubscriptionGuard } from '@/components/auth/SubscriptionGuard'
import { PatientRowSkeleton } from '@/components/ui/Skeleton'
import { GuideBox } from '@/components/ui/GuideBox'

type PatientWithTutor = {
    id: string
    name: string
    species: string
    breed: string | null
    sex: 'M' | 'H' | 'MN' | 'FN'
    created_at: string
    is_sterilized: boolean
    tutors: {
        id: string
        name: string
    } | null
}

export default function Patients() {
    const { profile } = useAuth()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [patients, setPatients] = useState<PatientWithTutor[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [speciesFilter, setSpeciesFilter] = useState<'all' | 'dog' | 'cat' | 'other'>('all')

    useEffect(() => {
        fetchPatients()
    }, [profile?.clinic_id])

    const fetchPatients = async () => {
        if (!profile?.clinic_id) return
        setLoading(true)
        try {
            const { data, error } = await supabase
                .from('patients')
                .select('*, tutors(id, name)')
                .eq('clinic_id', profile.clinic_id)
                .is('death_date', null)
                .order('created_at', { ascending: false })

            if (error) throw error
            setPatients((data as any) || [])
        } catch (error) {
            console.error('Error fetching patients:', error)
        } finally {
            setLoading(false)
        }
    }

    const filteredPatients = patients.filter(p => {
        const matchesSearch = 
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.tutors?.name?.toLowerCase().includes(searchQuery.toLowerCase())
        
        const matchesSpecies = 
            speciesFilter === 'all' || 
            (speciesFilter === 'dog' && p.species.toLowerCase() === 'canino') ||
            (speciesFilter === 'cat' && p.species.toLowerCase() === 'felino') ||
            (speciesFilter === 'other' && !['canino', 'felino'].includes(p.species.toLowerCase()))

        return matchesSearch && matchesSpecies
    })

    const getSexLabel = (sex: string) => {
        const s = sex?.toUpperCase()
        if (s === 'M' || s === 'MN') return 'Macho'
        if (s === 'F' || s === 'FN' || s === 'H') return 'Hembra'
        return sex || '-'
    }

    return (
        <SubscriptionGuard>
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
                                    <Dog className="w-8 h-8 sm:w-10 sm:h-10 text-white drop-shadow-md" />
                                </div>
                            </div>
                            <div>
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-[12px] font-bold uppercase tracking-widest mb-3 animate-fade-in">
                                    <Dog className="w-3.5 h-3.5 text-amber-300" />
                                    <span className="text-amber-50">Base de Datos Clínica</span>
                                </div>
                                <h1 className="text-2xl sm:text-3xl font-black mb-2 tracking-tight drop-shadow-sm uppercase text-white">
                                    Gestión de Pacientes
                                </h1>
                                <p className="text-emerald-50/90 text-sm sm:text-base max-w-xl font-semibold leading-relaxed">
                                    Listado global de mascotas registradas. Accede a fichas clínicas, tratamientos y evoluciones con un solo click.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <GuideBox title="Administración de Pacientes" summary="Accede a la ficha clínica y evolución de las mascotas.">
                    <div className="space-y-4">
                        <p>Busca pacientes rápidamente y accede a su historia médica.</p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li>Usa el filtro de especie para encontrar rápidamente los pacientes.</li>
                            <li>Da click en un paciente para ver su ficha clínica y atenciones.</li>
                        </ul>
                    </div>
                </GuideBox>

                {/* Filters */}
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal/40" />
                        <input
                            type="text"
                            placeholder="Buscar por nombre de mascota o tutor..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-soft pl-10 w-full"
                        />
                    </div>
                    <div className="flex items-center gap-1 bg-silk-beige/30 p-1 rounded-lg w-fit">
                        <button
                            onClick={() => setSpeciesFilter('all')}
                            className={cn(
                                "px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-md transition-all",
                                speciesFilter === 'all' ? "bg-white text-primary-700 shadow-sm" : "text-charcoal/40 hover:text-charcoal"
                            )}
                        >
                            Todos
                        </button>
                        <button
                            onClick={() => setSpeciesFilter('dog')}
                            className={cn(
                                "px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-md transition-all",
                                speciesFilter === 'dog' ? "bg-white text-primary-700 shadow-sm" : "text-charcoal/40 hover:text-charcoal"
                            )}
                        >
                            Caninos
                        </button>
                        <button
                            onClick={() => setSpeciesFilter('cat')}
                            className={cn(
                                "px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-md transition-all",
                                speciesFilter === 'cat' ? "bg-white text-primary-700 shadow-sm" : "text-charcoal/40 hover:text-charcoal"
                            )}
                        >
                            Felinos
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="card-soft overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-silk-beige bg-ivory">
                                    <th className="text-left py-4 px-6 text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest">Paciente / Especie</th>
                                    <th className="text-left py-4 px-6 text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest">Sexo / Estado</th>
                                    <th className="text-left py-4 px-6 text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest">Tutor Responsable</th>
                                    <th className="text-left py-4 px-6 text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest">Fecha Alta</th>
                                    <th className="text-right py-4 px-6 text-xs font-bold font-bold text-charcoal/40 uppercase tracking-widest">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-silk-beige">
                                {loading ? (
                                    <>
                                        <PatientRowSkeleton />
                                        <PatientRowSkeleton />
                                        <PatientRowSkeleton />
                                        <PatientRowSkeleton />
                                        <PatientRowSkeleton />
                                    </>
                                ) : filteredPatients.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="py-20 text-center text-charcoal/50 font-medium">
                                            {searchQuery ? 'No se encontraron mascotas que coincidan' : 'No hay pacientes registrados aún'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredPatients.map((patient) => (
                                        <tr
                                            key={patient.id}
                                            className="transition-colors group hover:bg-silk-beige/30 cursor-pointer"
                                            onClick={() => navigate(`/app/patients/${patient.id}`)}
                                        >
                                            <td className="py-4 px-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-full bg-ivory flex items-center justify-center border border-silk-beige group-hover:border-primary-200 transition-colors">
                                                        <Dog className="w-5 h-5 text-primary-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-charcoal uppercase text-xs tracking-wide group-hover:text-primary-700 transition-colors">
                                                            {patient.name}
                                                        </p>
                                                        <p className="text-xs font-bold text-charcoal/40 font-bold uppercase tracking-widest">
                                                            {patient.species} • {patient.breed || 'Sin raza'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-4 px-6">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-xs font-extrabold text-charcoal uppercase tracking-tighter">
                                                        {getSexLabel(patient.sex)}
                                                    </span>
                                                    {patient.is_sterilized && (
                                                        <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest bg-emerald-50 w-fit px-1.5 py-0.5 rounded-[4px] border border-emerald-100/50">
                                                            CASTRADO/A
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-4 px-6">
                                                <div className="flex items-center gap-2">
                                                    <User className="w-3.5 h-3.5 text-charcoal/30" />
                                                    <span className="text-xs font-bold text-charcoal/80 uppercase tracking-wide">
                                                        {patient.tutors?.name || 'Sin tutor'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-4 px-6">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="w-3.5 h-3.5 text-charcoal/30" />
                                                    <span className="text-xs font-medium text-charcoal/60">
                                                        {new Date(patient.created_at).toLocaleDateString('es-ES')}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <ChevronRight className="w-5 h-5 ml-auto text-charcoal/20 group-hover:text-primary-500 transition-all group-hover:translate-x-1" />
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </SubscriptionGuard>
    )
}
