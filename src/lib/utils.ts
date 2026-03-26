import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string): string {
    const d = new Date(date)
    return d.toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })
}

export function formatTime(date: Date | string): string {
    const d = new Date(date)
    return d.toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
    })
}

export function formatDateTime(date: Date | string): string {
    return `${formatDate(date)} a las ${formatTime(date)}`
}

export function formatPhoneNumber(phone: string): string {
    // Format: +52 55 1234 5678
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length === 12 && cleaned.startsWith('52')) {
        return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 4)} ${cleaned.slice(4, 8)} ${cleaned.slice(8)}`
    }
    return phone
}

export function getInitials(name: string): string {
    return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
}

export function getStatusColor(status: string): string {
    const colors: Record<string, string> = {
        pending: 'badge-pending',
        confirmed: 'badge-confirmed',
        cancelled: 'badge-cancelled',
        completed: 'badge-completed',
    }
    return colors[status] || 'badge-pending'
}

export function getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        pending: 'Pendiente',
        confirmed: 'Confirmada',
        cancelled: 'Cancelada',
        completed: 'Completada',
    }
    return labels[status] || status
}
