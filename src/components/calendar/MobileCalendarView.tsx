import { useState, useMemo, useEffect } from 'react';
import {
    format,
    addMonths,
    subMonths,
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    isToday,
    startOfWeek,
    endOfWeek,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { CalendarEvent } from './CalendarView';

interface MobileCalendarViewProps {
    events: CalendarEvent[];
    onSelectEvent: (event: CalendarEvent) => void;
    onSelectSlot?: (date: Date) => void;
}

export function MobileCalendarView({ events, onSelectEvent, onSelectSlot }: MobileCalendarViewProps) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());

    // Sync selectedDate with current month when changing months
    useEffect(() => {
        if (!isSameMonth(selectedDate, currentDate)) {
            // Uncomment to auto-select the 1st of the month when turning pages
            // setSelectedDate(startOfMonth(currentDate))
        }
    }, [currentDate, selectedDate]);

    const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

    // Calendar Grid Logic
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 }); // Start Monday
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const dateFormat = "d";
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    const weekDays = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

    // Get events for the selected day
    const selectedDayEvents = useMemo(() => {
        return events
            .filter(event => isSameDay(new Date(event.start), selectedDate))
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    }, [events, selectedDate]);

    // Check if a day has events (for the dot indicator)
    const hasEvents = (day: Date) => {
        return events.some(event => isSameDay(new Date(event.start), day));
    };

    return (
        <div className="flex flex-col h-full bg-charcoal min-h-[600px] text-white rounded-2xl overflow-hidden shadow-2xl">
            {/* Calendar Header / Picker */}
            <div className="bg-charcoal px-4 pt-6 pb-2 flex-shrink-0">
                <div className="flex justify-between items-center mb-6 px-2">
                    <h2 className="text-xl font-medium text-white capitalize">
                        {format(currentDate, 'MMMM yyyy', { locale: es })}
                    </h2>
                    <div className="flex gap-4">
                        <button onClick={prevMonth} className="p-2 text-white/70 hover:text-white transition-colors active:scale-95">
                            <ChevronLeft className="w-6 h-6" />
                        </button>
                        <button onClick={nextMonth} className="p-2 text-white/70 hover:text-white transition-colors active:scale-95">
                            <ChevronRight className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                {/* Weekdays Header */}
                <div className="grid grid-cols-7 mb-2">
                    {weekDays.map(day => (
                        <div key={day} className="text-center text-xs font-semibold text-white/50 uppercase tracking-widest">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Days Grid */}
                <div className="grid grid-cols-7 gap-y-2">
                    {days.map((day, idx) => {
                        const isSelected = isSameDay(day, selectedDate);
                        const isCurrentMonth = isSameMonth(day, monthStart);
                        const isTodaysDate = isToday(day);
                        const hasAppointments = hasEvents(day);

                        return (
                            <div
                                key={idx}
                                className="relative flex flex-col items-center justify-center p-1 h-12"
                            >
                                <button
                                    onClick={() => {
                                        setSelectedDate(day);
                                        if (!isCurrentMonth) {
                                            setCurrentDate(day);
                                        }
                                        if (onSelectSlot) {
                                            onSelectSlot(day);
                                        }
                                    }}
                                    className={`
                                        w-8 h-8 flex items-center justify-center rounded-full text-sm transition-all
                                        ${isSelected ? 'bg-primary-500 text-white font-bold shadow-md shadow-primary-500/30' : ''}
                                        ${!isSelected && isTodaysDate ? 'text-primary-400 font-bold border border-primary-500/50' : ''}
                                        ${!isSelected && !isTodaysDate && isCurrentMonth ? 'text-white/90 hover:bg-white/10' : ''}
                                        ${!isCurrentMonth && !isSelected ? 'text-white/30' : ''}
                                    `}
                                >
                                    <span>{format(day, dateFormat)}</span>
                                </button>
                                {/* Event Dot Indicator */}
                                {hasAppointments && (
                                    <div className={`absolute bottom-1 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-primary-500'}`} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Agenda List View */}
            <div className="flex-1 bg-white rounded-t-3xl mt-2 overflow-hidden flex flex-col">
                <div className="p-5 flex-shrink-0 border-b border-ivory flex justify-between items-center">
                    <h3 className="font-semibold text-charcoal capitalize">
                        {format(selectedDate, "EEEE, d 'de' MMMM", { locale: es })}
                    </h3>
                    {selectedDayEvents.length > 0 && (
                        <span className="text-xs font-medium px-2.5 py-1 bg-primary-50 text-primary-700 rounded-full">
                            {selectedDayEvents.length} {selectedDayEvents.length === 1 ? 'cita' : 'citas'}
                        </span>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {selectedDayEvents.length > 0 ? (
                        selectedDayEvents.map(event => {
                            const startTime = format(new Date(event.start), 'HH:mm');
                            const endTime = format(new Date(event.end), 'HH:mm');
                            const professionalColor = event.resource?.professionalColor || '#8B5CF6';
                            const professionalName = event.resource?.professionalName || 'Sin asignar';
                            const patientName = event.resource?.patient_name || event.title;
                            const serviceName = event.resource?.service || '';

                            return (
                                <div
                                    key={event.id}
                                    onClick={() => onSelectEvent(event)}
                                    className="bg-ivory/30 border border-silk-beige rounded-2xl p-4 cursor-pointer hover:shadow-premium-sm transition-all active:scale-[0.98] flex gap-4"
                                    style={{ borderLeftColor: professionalColor, borderLeftWidth: '4px' }}
                                >
                                    {/* Time Column */}
                                    <div className="flex flex-col items-center justify-center min-w-[60px] flex-shrink-0 border-r border-silk-beige/50 pr-4">
                                        <span className="text-sm font-bold text-charcoal">{startTime}</span>
                                        <span className="text-xs font-medium text-charcoal/40">{endTime}</span>
                                    </div>

                                    {/* Details Column */}
                                    <div className="flex flex-col justify-center flex-1 min-w-0">
                                        <h4 className="font-semibold text-charcoal truncate text-base mb-0.5">
                                            {patientName}
                                        </h4>
                                        <div className="flex items-center gap-1.5 text-sm text-charcoal/60 truncate mb-1">
                                            <CalendarIcon className="w-3.5 h-3.5 flex-shrink-0" />
                                            <span className="truncate">{serviceName}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 align-middle">
                                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: professionalColor }}></div>
                                            <span className="text-xs font-medium text-charcoal/50 truncate">
                                                {professionalName}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-charcoal/40 space-y-3 py-10 mt-10">
                            <CalendarIcon className="w-12 h-12 opacity-20" />
                            <p className="font-medium text-center">No hay citas programadas<br />para este día</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
