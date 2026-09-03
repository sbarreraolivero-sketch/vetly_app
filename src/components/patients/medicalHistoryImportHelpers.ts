// Helpers puros del importador de historial médico (HQ) — sin dependencias
// de React, para poder testear/reusar la lógica de matching por separado
// del componente visual. Ver plan de la feature: el matching se resuelve
// UNA VEZ POR GRUPO (paciente+tutor), no fila por fila.

export interface RosterPatient {
    id: string
    name: string
    species: string | null
    tutor_id: string | null
    tutor_name: string | null
    tutor_phone: string | null
}

export type EventType = 'vaccine' | 'deworming' | 'consultation' | 'patient_record' | 'unknown'

export interface ExtractedEvent {
    row_index: number
    event_type: EventType
    patient_name: string | null
    tutor_name: string | null
    tutor_phone: string | null
    // Metadata de ficha — viene sobre todo en filas patient_record, pero la IA
    // también puede rellenarla en filas de vacuna/desparasitación/consulta:
    species: string | null
    breed: string | null
    sex: string | null
    dob: string | null
    microchip: string | null
    tutor_email: string | null
    tutor_address: string | null
    vaccine_name: string | null
    deworming_type: string | null
    deworming_brand: string | null
    weight: number | null
    application_date: string | null
    next_dose_date: string | null
    reason: string | null
    diagnosis: string | null
    anamnesis: string | null
    procedure_notes: string | null
    event_date: string | null
    notes: string | null
    sheet_name: string
    // Poblado durante el agrupamiento — sobrevive al reemplazo de objetos en
    // el paso de revisión (a diferencia de buscar por identidad):
    _groupKey?: string
    // Poblado en el paso de revisión, no viene de la IA:
    patient_id?: string | null
    selected?: boolean
}

export function isMedicalEvent(ev: ExtractedEvent): boolean {
    return ev.event_type === 'vaccine' || ev.event_type === 'deworming' || ev.event_type === 'consultation'
}

// Sin librería de normalización de acentos — NFD + strip de diacríticos es
// suficiente y no agrega dependencias nuevas.
export function normalize(s: string | null | undefined): string {
    if (!s) return ''
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function normalizePhoneDigits(s: string | null | undefined): string {
    return (s || '').replace(/\D/g, '')
}

export function chunkRows<T>(rows: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
    return out
}

export interface PatientGroup {
    key: string
    patientNameRaw: string
    tutorNameRaw: string
    tutorPhoneRaw: string
    // Metadata de ficha para crear la mascota/el dueño si no existen —
    // poblada desde cualquier evento del grupo que la traiga:
    speciesRaw: string | null
    breedRaw: string | null
    sexRaw: string | null
    dobRaw: string | null
    microchipRaw: string | null
    tutorEmailRaw: string | null
    tutorAddressRaw: string | null
    events: ExtractedEvent[]
    matchStatus: 'auto' | 'ambiguous' | 'no_match'
    candidates: RosterPatient[]
    resolvedPatientId: string | null
    // true → se creará una mascota (y su dueño si falta) para este grupo.
    // Default: true cuando no hay match con un paciente existente.
    willCreate: boolean
}

// El primer valor no vacío gana — la hoja "Pacientes" suele traer la ficha
// completa, pero si un campo solo aparece en una fila de vacuna, se usa igual.
function firstNonEmpty(current: string | null, incoming: string | null | undefined): string | null {
    if (current && current.trim() !== '') return current
    const v = (incoming ?? '').toString().trim()
    return v === '' ? null : v
}

export function groupByPatientTutor(events: ExtractedEvent[]): PatientGroup[] {
    const groups = new Map<string, PatientGroup>()
    for (const ev of events) {
        const key = `${normalize(ev.patient_name)}|${normalize(ev.tutor_name)}`
        ev._groupKey = key
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                patientNameRaw: ev.patient_name || '(sin nombre)',
                tutorNameRaw: ev.tutor_name || '',
                tutorPhoneRaw: ev.tutor_phone || '',
                speciesRaw: null, breedRaw: null, sexRaw: null, dobRaw: null,
                microchipRaw: null, tutorEmailRaw: null, tutorAddressRaw: null,
                events: [],
                matchStatus: 'no_match',
                candidates: [],
                resolvedPatientId: null,
                willCreate: false,
            })
        }
        const g = groups.get(key)!
        g.events.push(ev)
        g.tutorPhoneRaw = firstNonEmpty(g.tutorPhoneRaw || null, ev.tutor_phone) || ''
        g.speciesRaw = firstNonEmpty(g.speciesRaw, ev.species)
        g.breedRaw = firstNonEmpty(g.breedRaw, ev.breed)
        g.sexRaw = firstNonEmpty(g.sexRaw, ev.sex)
        g.dobRaw = firstNonEmpty(g.dobRaw, ev.dob)
        g.microchipRaw = firstNonEmpty(g.microchipRaw, ev.microchip)
        g.tutorEmailRaw = firstNonEmpty(g.tutorEmailRaw, ev.tutor_email)
        g.tutorAddressRaw = firstNonEmpty(g.tutorAddressRaw, ev.tutor_address)
    }
    return Array.from(groups.values())
}

// Fusiona grupos sin dueño dentro del grupo con dueño de la MISMA mascota.
// Caso real: la hoja "Vacunas" trae solo el nombre de la mascota, la hoja
// "Pacientes" trae mascota + dueño → sin esto quedan como dos grupos ("mila|"
// y "mila|juan perez") y el primero no se puede vincular ni crear bien.
// Si hay 2+ dueños distintos para el mismo nombre de mascota, no se fusiona
// (ambiguo — el operador decide en el paso de matching).
export function mergeGroupsByPatientName(groups: PatientGroup[]): PatientGroup[] {
    const withTutor = groups.filter(g => normalize(g.tutorNameRaw) !== '')
    const withoutTutor = groups.filter(g => normalize(g.tutorNameRaw) === '')
    if (withoutTutor.length === 0) return groups

    const result = [...withTutor]
    for (const orphan of withoutTutor) {
        const pn = normalize(orphan.patientNameRaw)
        const targets = result.filter(g => normalize(g.patientNameRaw) === pn)
        if (targets.length === 1) {
            const t = targets[0]
            for (const ev of orphan.events) {
                ev._groupKey = t.key
                t.events.push(ev)
            }
            t.speciesRaw = firstNonEmpty(t.speciesRaw, orphan.speciesRaw)
            t.breedRaw = firstNonEmpty(t.breedRaw, orphan.breedRaw)
            t.sexRaw = firstNonEmpty(t.sexRaw, orphan.sexRaw)
            t.dobRaw = firstNonEmpty(t.dobRaw, orphan.dobRaw)
            t.microchipRaw = firstNonEmpty(t.microchipRaw, orphan.microchipRaw)
            t.tutorEmailRaw = firstNonEmpty(t.tutorEmailRaw, orphan.tutorEmailRaw)
            t.tutorAddressRaw = firstNonEmpty(t.tutorAddressRaw, orphan.tutorAddressRaw)
            if (!t.tutorPhoneRaw && orphan.tutorPhoneRaw) t.tutorPhoneRaw = orphan.tutorPhoneRaw
        } else {
            // 0 → nadie con ese nombre y dueño; 2+ → ambiguo. En ambos casos
            // el grupo huérfano sigue solo.
            result.push(orphan)
        }
    }
    return result
}

// Resuelve un grupo contra el roster real de la clínica:
// - 1 candidato inequívoco (por teléfono del tutor si vino en el archivo,
//   si no por nombre de tutor) → auto.
// - 0 o 2+ candidatos → ambiguous (el operador elige a mano).
// - Ningún paciente con ese nombre en absoluto → no_match.
export function matchPatientGroup(group: PatientGroup, roster: RosterPatient[]): PatientGroup {
    const patientNameNorm = normalize(group.patientNameRaw)
    const tutorPhoneNorm = normalizePhoneDigits(group.tutorPhoneRaw)
    const tutorNameNorm = normalize(group.tutorNameRaw)

    const byName = roster.filter(p => normalize(p.name) === patientNameNorm)

    let candidates = byName
    if (tutorPhoneNorm) {
        const byPhone = byName.filter(p => normalizePhoneDigits(p.tutor_phone) === tutorPhoneNorm)
        if (byPhone.length > 0) candidates = byPhone
    } else if (tutorNameNorm) {
        const byTutorName = byName.filter(p => normalize(p.tutor_name) === tutorNameNorm)
        if (byTutorName.length > 0) candidates = byTutorName
    }

    if (candidates.length === 1) {
        return { ...group, candidates, matchStatus: 'auto', resolvedPatientId: candidates[0].id, willCreate: false }
    }
    if (byName.length > 0) {
        // Había candidatos por nombre pero el teléfono/tutor no desambiguó —
        // se muestran todos los candidatos por nombre para elegir a mano.
        return { ...group, candidates: byName, matchStatus: 'ambiguous', resolvedPatientId: null, willCreate: false }
    }
    // Ningún paciente con ese nombre → por defecto se crea uno nuevo (el
    // operador puede desmarcarlo o vincularlo a un existente en el paso de
    // matching).
    return { ...group, candidates: [], matchStatus: 'no_match', resolvedPatientId: null, willCreate: true }
}

// Lee un archivo .xlsx/.xls/.csv y devuelve sus hojas no vacías como filas
// de objetos (una clave por columna). Import dinámico de SheetJS — no
// engorda el bundle del cliente final, esto solo se usa en /hq/*.
export async function parseSpreadsheet(file: File): Promise<{ sheetName: string; rows: Record<string, string>[] }[]> {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: true })
    return wb.SheetNames
        .map(sheetName => {
            const sheet = wb.Sheets[sheetName]
            const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { raw: false, defval: '' })
            return { sheetName, rows }
        })
        .filter(s => s.rows.length > 0)
}
