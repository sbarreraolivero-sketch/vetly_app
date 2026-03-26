import { Database } from '@/types/database'

type Patient = Database['public']['Tables']['patients']['Row']
type ClinicalRecord = Database['public']['Tables']['clinical_records']['Row']
type Tag = { id: string; name: string; color: string }

export const suggestTags = (
    patient: Patient,
    records: ClinicalRecord[],
    currentTags: Tag[],
    availableTags: Tag[]
): Tag[] => {
    const suggestions: Tag[] = []
    const now = new Date()
    const lastVisit = patient.last_appointment_at ? new Date(patient.last_appointment_at) : null

    // Helper to find tag by name (case insensitive)
    const findTag = (name: string) => availableTags.find(t => t.name.toLowerCase() === name.toLowerCase())

    // Helper to check if patient already has tag
    const hasTag = (tag: Tag) => currentTags.some(t => t.id === tag.id)

    // Rule 1: "Cliente Frecuente" (VIP) - More than 5 appointments
    if ((patient.total_appointments || 0) > 5) {
        const vipTag = findTag('VIP') || findTag('Cliente Frecuente')
        if (vipTag && !hasTag(vipTag)) {
            suggestions.push(vipTag)
        }
    }

    // Rule 2: "Inactivo" - No visits in last 6 months
    if (lastVisit) {
        const monthsSinceLastVisit = (now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24 * 30)
        if (monthsSinceLastVisit > 6) {
            const inactiveTag = findTag('Inactivo') || findTag('Recuperar')
            if (inactiveTag && !hasTag(inactiveTag)) {
                suggestions.push(inactiveTag)
            }
        }
    }

    // Rule 3: "Nuevo" - Created less than 1 month ago and <= 1 appointment
    const createdAt = new Date(patient.created_at)
    const monthsSinceCreated = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30)
    if (monthsSinceCreated < 1 && (patient.total_appointments || 0) <= 1) {
        const newTag = findTag('Nuevo')
        if (newTag && !hasTag(newTag)) {
            suggestions.push(newTag)
        }
    }

    // Rule 4: Treatment Specific (Botox, Dental, etc.)
    const treatments = records.map(r => r.treatment_name.toLowerCase())

    if (treatments.some(t => t.includes('botox') || t.includes('toxina'))) {
        const botoxTag = findTag('Botox')
        if (botoxTag && !hasTag(botoxTag)) {
            suggestions.push(botoxTag)
        }
    }

    if (treatments.some(t => t.includes('limpieza') || t.includes('facial'))) {
        const facialTag = findTag('Facial')
        if (facialTag && !hasTag(facialTag)) {
            suggestions.push(facialTag)
        }
    }

    return suggestions
}
