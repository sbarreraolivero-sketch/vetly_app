/**
 * RoutePlanPanel — plan de ruta por fecha para clínicas móviles con sectorización.
 *
 * Permite marcar días puntuales en los que el móvil recorre solo ciertos sectores
 * (ej: "mañana solo Linares, el miércoles solo Talca"). Un día sin marcar se
 * comporta como siempre, sin restricción.
 *
 * El bloqueo real lo aplica checkAvail en el webhook — este panel solo escribe
 * la tabla clinic_route_plan.
 */
import { useEffect, useState } from 'react'
import { addDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Route, Check, Loader2, RotateCcw, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const DAYS_AHEAD = 14

interface RoutePlanRow {
    date: string
    allowed_sectors: string[]
    note: string | null
}

interface RoutePlanPanelProps {
    clinicId: string
    /** Sectores disponibles para esta clínica. */
    sectors: string[]
    /** "Hoy" en la zona horaria de la clínica, en formato yyyy-MM-dd. */
    todayStr: string
}

export function RoutePlanPanel({ clinicId, sectors, todayStr }: RoutePlanPanelProps) {
    // Colapsado por defecto: la lista de 14 días ocupa mucho espacio en la página.
    const [expanded, setExpanded] = useState(false)
    const [plan, setPlan] = useState<Record<string, RoutePlanRow>>({})
    const [loading, setLoading] = useState(true)
    const [savingDate, setSavingDate] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Los próximos DAYS_AHEAD días a partir de "hoy" en la zona de la clínica.
    // Se construye con mediodía para que ningún cambio de horario corra el día.
    const days = Array.from({ length: DAYS_AHEAD }, (_, i) =>
        format(addDays(new Date(`${todayStr}T12:00:00`), i), 'yyyy-MM-dd')
    )

    useEffect(() => {
        if (!clinicId) return
        let cancelled = false

        const fetchPlan = async () => {
            setLoading(true)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error: err } = await (supabase as any)
                .from('clinic_route_plan')
                .select('date, allowed_sectors, note')
                .eq('clinic_id', clinicId)
                .gte('date', days[0])
                .lte('date', days[days.length - 1])

            if (cancelled) return
            if (err) {
                setError('No se pudo cargar el plan de ruta.')
            } else {
                const map: Record<string, RoutePlanRow> = {}
                for (const row of data || []) map[row.date] = row as RoutePlanRow
                setPlan(map)
                setError(null)
            }
            setLoading(false)
        }

        fetchPlan()
        return () => { cancelled = true }
    }, [clinicId, todayStr])

    const persist = async (date: string, sectorsForDay: string[], note: string | null) => {
        setSavingDate(date)
        setError(null)

        // Sin sectores marcados = sin restricción: se borra la fila en vez de
        // guardar un array vacío, para que el día vuelva a la logística normal.
        if (sectorsForDay.length === 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: err } = await (supabase as any)
                .from('clinic_route_plan')
                .delete()
                .eq('clinic_id', clinicId)
                .eq('date', date)
            if (err) {
                setError('No se pudo guardar el cambio. Intenta de nuevo.')
            } else {
                setPlan(curr => {
                    const next = { ...curr }
                    delete next[date]
                    return next
                })
            }
            setSavingDate(null)
            return
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: err } = await (supabase as any)
            .from('clinic_route_plan')
            .upsert(
                { clinic_id: clinicId, date, allowed_sectors: sectorsForDay, note, updated_at: new Date().toISOString() },
                { onConflict: 'clinic_id,date' }
            )

        if (err) {
            setError('No se pudo guardar el cambio. Intenta de nuevo.')
        } else {
            setPlan(curr => ({ ...curr, [date]: { date, allowed_sectors: sectorsForDay, note } }))
        }
        setSavingDate(null)
    }

    const toggleSector = (date: string, sector: string) => {
        const current = plan[date]?.allowed_sectors || []
        const next = current.includes(sector)
            ? current.filter(s => s !== sector)
            : [...current, sector]
        persist(date, next, plan[date]?.note ?? null)
    }

    const clearDay = (date: string) => persist(date, [], null)

    const restrictedCount = days.filter(d => (plan[d]?.allowed_sectors?.length || 0) > 0).length

    return (
        <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
            <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="w-full text-left bg-gradient-to-br from-primary-500 to-primary-700 p-5 text-white"
            >
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-primary-200 mb-1">Logística</p>
                        <h3 className="text-lg font-extrabold tracking-tight text-white">Plan de ruta del móvil</h3>
                        <p className="text-xs sm:text-sm text-primary-100 mt-1 max-w-xl">
                            Marca los días en que el móvil recorre solo ciertos sectores. La IA no ofrecerá
                            horas de los sectores no marcados y derivará al cliente al día que sí corresponde.
                            Los días sin marcar funcionan como siempre.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Route className="w-8 h-8 text-primary-200 hidden sm:block" />
                        <ChevronDown className={cn('w-5 h-5 text-primary-200 transition-transform', expanded && 'rotate-180')} />
                    </div>
                </div>
                {restrictedCount > 0 && (
                    <p className="text-xs font-bold text-primary-100 mt-3 bg-white/10 rounded-lg px-3 py-1.5 inline-block">
                        {restrictedCount} {restrictedCount === 1 ? 'día con ruta acotada' : 'días con ruta acotada'} en las próximas 2 semanas
                    </p>
                )}
            </button>

            {expanded && (
            <div className="p-5">
                {error && (
                    <div className="mb-4 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center gap-2 text-charcoal/60 text-sm py-6 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Cargando plan de ruta...
                    </div>
                ) : (
                    <div className="divide-y divide-silk-beige">
                        {days.map(date => {
                            const row = plan[date]
                            const active = row?.allowed_sectors || []
                            const isToday = date === todayStr
                            const label = format(new Date(`${date}T12:00:00`), "EEEE d 'de' MMMM", { locale: es })

                            return (
                                <div key={date} className="flex flex-col sm:flex-row sm:items-center gap-3 py-3">
                                    <div className="sm:w-52 shrink-0">
                                        <p className={cn(
                                            'text-sm font-bold capitalize',
                                            active.length > 0 ? 'text-primary-700' : 'text-charcoal'
                                        )}>
                                            {label}
                                        </p>
                                        <p className="text-xs text-charcoal/40">
                                            {isToday ? 'Hoy' : date}
                                        </p>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        {sectors.map(sector => {
                                            const on = active.includes(sector)
                                            return (
                                                <button
                                                    key={sector}
                                                    onClick={() => toggleSector(date, sector)}
                                                    disabled={savingDate === date}
                                                    className={cn(
                                                        'flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50',
                                                        on
                                                            ? 'bg-primary-600 text-white border-primary-600'
                                                            : 'bg-ivory text-charcoal/60 border-silk-beige hover:border-primary-300'
                                                    )}
                                                >
                                                    {on && <Check className="w-3 h-3" />}
                                                    {sector}
                                                </button>
                                            )
                                        })}

                                        {active.length > 0 && (
                                            <button
                                                onClick={() => clearDay(date)}
                                                disabled={savingDate === date}
                                                title="Quitar la restricción de este día"
                                                className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-charcoal/50 hover:text-charcoal hover:bg-ivory transition-colors disabled:opacity-50"
                                            >
                                                <RotateCcw className="w-3 h-3" />
                                                Sin restricción
                                            </button>
                                        )}

                                        {savingDate === date && (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-600" />
                                        )}
                                    </div>

                                    {active.length > 0 && (
                                        <p className="text-xs text-charcoal/50 sm:ml-auto">
                                            Solo <span className="font-bold text-charcoal/70">{active.join(' y ')}</span>
                                        </p>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}

                <p className="text-xs text-charcoal/40 mt-4 pt-4 border-t border-silk-beige">
                    Al marcar un sector, ese día queda reservado solo para esas zonas: la IA dejará de
                    ofrecer horarios a clientes de los otros sectores y les propondrá la fecha más
                    próxima en que sí se recorre su zona. No afecta a las citas ya agendadas.
                </p>
            </div>
            )}
        </div>
    )
}
