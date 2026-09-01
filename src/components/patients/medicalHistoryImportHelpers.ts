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

export type EventType = 'vaccine' | 'deworming' | 'consultation' | 'unknown'

export interface ExtractedEvent {
    row_index: number
    event_type: EventType
    patient_name: string | null
    tutor_name: string | null
    tutor_phone: string | null
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
    // Poblado en el paso de revisión, no viene de la IA:
    patient_id?: string | null
    selected?: boolean
}

// Sin librería de normalización de acentos — NFD + strip de diacríticos es
// suficiente y no agrega dependencias nuevas (mismo criterio que `norm()`
// en CSVUploader.tsx, replicado acá para no acoplar dos features).
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
    events: ExtractedEvent[]
    matchStatus: 'auto' | 'ambiguous' | 'no_match'
    candidates: RosterPatient[]
    resolvedPatientId: string | null
}

export function groupByPatientTutor(events: ExtractedEvent[]): PatientGroup[] {
    const groups = new Map<string, PatientGroup>()
    for (const ev of events) {
        const key = `${normalize(ev.patient_name)}|${normalize(ev.tutor_name)}`
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                patientNameRaw: ev.patient_name || '(sin nombre)',
                tutorNameRaw: ev.tutor_name || '',
                tutorPhoneRaw: ev.tutor_phone || '',
                events: [],
                matchStatus: 'no_match',
                candidates: [],
                resolvedPatientId: null,
            })
        }
        groups.get(key)!.events.push(ev)
    }
    return Array.from(groups.values())
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
        return { ...group, candidates, matchStatus: 'auto', resolvedPatientId: candidates[0].id }
    }
    if (byName.length > 0) {
        // Había candidatos por nombre pero el teléfono/tutor no desambiguó —
        // se muestran todos los candidatos por nombre para elegir a mano.
        return { ...group, candidates: byName, matchStatus: 'ambiguous', resolvedPatientId: null }
    }
    return { ...group, candidates: [], matchStatus: 'no_match', resolvedPatientId: null }
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
