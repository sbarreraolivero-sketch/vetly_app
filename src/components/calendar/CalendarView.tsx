import React from 'react'
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const locales = {
    'es': es,
}

const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
})

export interface CalendarEvent {
    id: string
    title: string
    start: Date
    end: Date
    resource?: any
}

interface CalendarViewProps {
    events: CalendarEvent[]
    onSelectEvent: (event: CalendarEvent) => void
    onSelectSlot?: (slotInfo: { start: Date; end: Date }) => void
}

export function CalendarView({ events, onSelectEvent, onSelectSlot, onEditEvent }: CalendarViewProps & { onEditEvent?: (event: CalendarEvent) => void }) {

    // Custom Event Component for content only
    const CustomEvent = ({ event }: any) => {
        const isCancelled = event.resource?.status === 'cancelled'

        return (
            <div className={`h-full w-full py-1 px-2 flex flex-col justify-start pointer-events-none ${isCancelled ? 'line-through' : ''}`}>
                <div className="font-semibold leading-tight text-xs sm:text-sm truncate">{event.title}</div>
                <div className="text-xs font-bold sm:text-xs opacity-90 truncate mt-1 font-medium">
                    {format(event.start, 'h:mm a')} - {format(event.end, 'h:mm a')}
                </div>
            </div>
        )
    }

    // Event Wrapper to intercept clicks definitively
    const EventWrapper = (props: any) => {
        const { event, children } = props

        const handleClick = (e: React.MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()

            // Debug
            console.log('EventWrapper Click:', event)

            // High priority custom handler
            if (onEditEvent) {
                onEditEvent(event)
            } else if (onSelectEvent) {
                onSelectEvent(event)
            }
        }

        return React.cloneElement(children as React.ReactElement, {
            onClick: handleClick,
            title: `${event.title} - Haga clic para editar`,
            className: `${(children as React.ReactElement).props.className || ''} cursor-pointer hover:brightness-95`
        })
    }

    return (
        <div className="h-[1200px] sm:h-[1200px] bg-white rounded-2xl shadow-xl p-4 sm:p-6 animate-fade-in border-[3px] border-silk-beige/60 overflow-hidden relative">
            <style>{`
                .rbc-date-cell { padding-right: 8px !important; text-align: center !important; font-weight: 500; font-size: 0.875rem; }
                .rbc-header { padding: 8px 0 !important; font-size: 0.875rem; }
                @media (max-width: 640px) {
                    .rbc-time-view .rbc-header { font-size: 0.70rem; }
                    .rbc-time-view .rbc-time-content { min-width: 150%; } /* Allow horizontal scroll on tight mobile screens */
                }
            `}</style>
            <Calendar
                localizer={localizer}
                events={events}
                startAccessor="start"
                endAccessor="end"
                style={{ height: '100%' }}
                views={[Views.MONTH, Views.WEEK, Views.DAY]}
                defaultView={Views.WEEK}
                culture='es'
                step={30}
                timeslots={2}
                messages={{
                    next: "Siguiente",
                    previous: "Anterior",
                    today: "Hoy",
                    month: "Mes",
                    week: "Semana",
                    day: "Día",
                    agenda: "Agenda",
                    date: "Fecha",
                    time: "Hora",
                    event: "Cita",
                    noEventsInRange: "No hay citas en este rango",
                    showMore: (total) => `+ Ver más (${total})`
                }}
                onSelectEvent={onSelectEvent}
                onSelectSlot={onSelectSlot}
                selectable={!!onSelectSlot}
                selected={null}
                min={new Date(new Date().setHours(9, 0, 0, 0))} // Start at 9 AM
                max={new Date(new Date().setHours(21, 0, 0, 0))} // End at 9 PM
                scrollToTime={new Date(new Date().setHours(9, 0, 0, 0))} // Scroll to 9 AM initial
                components={{
                    toolbar: CustomToolbar,
                    event: CustomEvent,
                    eventWrapper: EventWrapper
                }}
                eventPropGetter={eventPropGetter}
                dayPropGetter={(date) => {
                    const params = { className: 'bg-white' }
                    if (date.getDay() === 0) params.className = 'bg-gray-50/50' // Sunday
                    return params
                }}
            />
        </div>
    )
}

// Event Style Getter
const eventPropGetter = (event: CalendarEvent) => {
    const isGoogle = event.resource?.type === 'google'
    const status = event.resource?.status || 'pending'
    const professionalColor = event.resource?.professionalColor

    let className = "border-l-4 text-xs rounded transition-all hover:brightness-95"

    // If professional has a color, use it for the border (except if appointment is cancelled)
    if (professionalColor && !isGoogle && status !== 'cancelled') {
        return {
            className: className + " !text-charcoal font-medium", // Force dark text with !important
            style: {
                border: 'none',
                borderLeftWidth: '5px', 
                borderLeftStyle: 'solid' as const,
                borderLeftColor: professionalColor,
                backgroundColor: professionalColor + '25', // Increased opacity from 15 to 25 (~15%)
            }
        }
    }

    if (isGoogle) {
        className += " bg-blue-50 border-blue-500 text-blue-700"
    } else {
        switch (status) {
            case 'confirmed':
                className += " bg-emerald-50 border-emerald-500 text-emerald-800"
                break
            case 'completed':
                className += " bg-primary-50 border-primary-500 text-primary-800"
                break
            case 'cancelled':
                className += " bg-red-50 border-red-500 text-red-800 opacity-75"
                break
            default: // pending
                className += " bg-amber-50 border-amber-500 text-amber-800"
        }
    }

    return {
        className,
        style: {
            border: 'none', // Override default full border if any
            borderLeftWidth: '4px',
            borderLeftStyle: 'solid' as const
        }
    }
}


const CustomToolbar = (toolbar: any) => {
    const goToBack = () => {
        toolbar.onNavigate('PREV')
    }

    const goToNext = () => {
        toolbar.onNavigate('NEXT')
    }

    const goToCurrent = () => {
        toolbar.onNavigate('TODAY')
    }

    const label = () => {
        const date = toolbar.date
        const view = toolbar.view

        let text = toolbar.label
        if (view === 'month') {
            text = format(date, 'MMMM yyyy', { locale: es })
        } else if (view === 'day') {
            text = format(date, "EEEE d 'de' MMMM, yyyy", { locale: es })
        }

        return (
            <span className="capitalize text-lg font-semibold text-charcoal">
                {text}
            </span>
        )
    }

    return (
        <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-4 w-full">
            <div className="flex flex-wrap items-center justify-center gap-2 w-full md:w-auto">
                <button
                    onClick={goToBack}
                    className="p-2 hover:bg-silk-beige rounded-soft transition-colors flex-shrink-0"
                >
                    <ChevronLeft className="w-5 h-5 text-charcoal/60" />
                </button>
                <button
                    onClick={goToCurrent}
                    className="px-3 py-1.5 text-sm font-medium text-charcoal/70 hover:bg-silk-beige rounded-soft transition-colors flex-shrink-0"
                >
                    Hoy
                </button>
                <button
                    onClick={goToNext}
                    className="p-2 hover:bg-silk-beige rounded-soft transition-colors flex-shrink-0"
                >
                    <ChevronRight className="w-5 h-5 text-charcoal/60" />
                </button>
                <div className="w-full text-center md:w-auto md:ml-2 mt-2 md:mt-0">
                    {label()}
                </div>
            </div>

            <div className="flex bg-silk-beige/50 p-1 rounded-soft overflow-x-auto w-full md:w-auto justify-center flex-shrink-0">
                {['month', 'week', 'day'].map((view) => (
                    <button
                        key={view}
                        onClick={() => toolbar.onView(view)}
                        className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-soft transition-all duration-200 capitalize whitespace-nowrap ${toolbar.view === view
                            ? 'bg-white shadow-soft text-primary-600'
                            : 'text-charcoal/60 hover:text-charcoal'
                            }`}
                    >
                        {view === 'month' ? 'Mes' : view === 'week' ? 'Semana' : 'Día'}
                    </button>
                ))}
            </div>
        </div>
    )
}
