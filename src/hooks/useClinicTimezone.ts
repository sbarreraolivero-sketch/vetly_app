/**
 * useClinicTimezone — provides timezone-aware date utilities 
 * tied to the clinic_settings.timezone configuration.
 *
 * This ensures that date filters (day, week, month, year) and 
 * date formatting use the clinic's timezone, not the browser's.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import {
    startOfDay as _startOfDay,
    endOfDay as _endOfDay,
    startOfWeek as _startOfWeek,
    endOfWeek as _endOfWeek,
    startOfMonth as _startOfMonth,
    endOfMonth as _endOfMonth,
    startOfYear as _startOfYear,
    endOfYear as _endOfYear,
    format as _format,
} from 'date-fns'
import { es } from 'date-fns/locale'

const DEFAULT_TZ = 'America/Santiago'

export function useClinicTimezone() {
    const { profile, member } = useAuth()
    const clinicId = member?.clinic_id || profile?.clinic_id
    const [timezone, setTimezone] = useState<string>(DEFAULT_TZ)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!clinicId) {
            setLoading(false)
            return
        }

        const fetchTimezone = async () => {
            try {
                const { data, error } = await (supabase as any)
                    .from('clinic_settings')
                    .select('timezone')
                    .eq('id', clinicId)
                    .single()

                if (!error && data?.timezone) {
                    setTimezone(data.timezone as string)
                }
            } catch (err) {
                console.error('Error fetching clinic timezone:', err)
            } finally {
                setLoading(false)
            }
        }

        fetchTimezone()
    }, [clinicId])

    /** Get the current time in the clinic's timezone */
    const now = useMemo(() => {
        return () => toZonedTime(new Date(), timezone)
    }, [timezone])

    /** Convert a UTC date to the clinic's timezone for display */
    const toClinicTime = useMemo(() => {
        return (date: Date | string) => toZonedTime(new Date(date), timezone)
    }, [timezone])

    /** Convert a clinic-local date to UTC for DB queries */
    const toUTC = useMemo(() => {
        return (clinicLocalDate: Date) => fromZonedTime(clinicLocalDate, timezone)
    }, [timezone])

    /** Format a date in the clinic's timezone.
     *  For date-only strings (YYYY-MM-DD), parses as local date (no TZ shift).
     *  For timestamps (with time), converts from UTC to clinic TZ. */
    const formatInTz = useMemo(() => {
        return (date: Date | string, formatStr: string) => {
            let d: Date
            if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
                // Date-only: parse as local to avoid UTC midnight rollback
                const [y, m, day] = date.split('-').map(Number)
                d = new Date(y, m - 1, day)
            } else {
                // Timestamp: convert from UTC to clinic timezone
                d = toZonedTime(new Date(date), timezone)
            }
            return _format(d, formatStr, { locale: es })
        }
    }, [timezone])

    /**
     * Get UTC start/end boundaries for a period.
     * "What is start-of-day / end-of-day in the clinic's timezone, expressed as UTC?"
     * These are the values you pass to DB queries.
     */
    const getDateRange = useMemo(() => {
        return (filterType: 'day' | 'week' | 'month' | 'year') => {
            const clinicNow = toZonedTime(new Date(), timezone)
            let start: Date, end: Date

            switch (filterType) {
                case 'day':
                    start = _startOfDay(clinicNow)
                    end = _endOfDay(clinicNow)
                    break
                case 'week':
                    start = _startOfWeek(clinicNow, { locale: es })
                    end = _endOfWeek(clinicNow, { locale: es })
                    break
                case 'month':
                    start = _startOfMonth(clinicNow)
                    end = _endOfMonth(clinicNow)
                    break
                case 'year':
                    start = _startOfYear(clinicNow)
                    end = _endOfYear(clinicNow)
                    break
            }

            // Convert back to UTC for DB queries
            return {
                start: fromZonedTime(start, timezone),
                end: fromZonedTime(end, timezone),
            }
        }
    }, [timezone])

    /** Human-readable label for the current date range */
    const getDateRangeLabel = useMemo(() => {
        return (filterType: 'day' | 'week' | 'month' | 'year') => {
            const clinicNow = toZonedTime(new Date(), timezone)

            switch (filterType) {
                case 'day':
                    return _format(clinicNow, "d 'de' MMMM yyyy", { locale: es })
                case 'week': {
                    const s = _startOfWeek(clinicNow, { locale: es })
                    const e = _endOfWeek(clinicNow, { locale: es })
                    return `${_format(s, 'd MMM', { locale: es })} – ${_format(e, "d MMM yyyy", { locale: es })}`
                }
                case 'month':
                    return _format(clinicNow, 'MMMM yyyy', { locale: es })
                case 'year':
                    return _format(clinicNow, 'yyyy')
            }
        }
    }, [timezone])

    /**
     * Parse a date-only string (YYYY-MM-DD) as the clinic's local date.
     * Avoids the UTC midnight pitfall where '2026-02-19' shows as Feb 18.
     */
    const parseLocalDate = useMemo(() => {
        return (dateStr: string) => {
            if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                const [y, m, d] = dateStr.split('-').map(Number)
                return new Date(y, m - 1, d)
            }
            return toZonedTime(new Date(dateStr), timezone)
        }
    }, [timezone])

    return {
        timezone,
        loading,
        now,
        toClinicTime,
        toUTC,
        formatInTz,
        getDateRange,
        getDateRangeLabel,
        parseLocalDate,
    }
}
