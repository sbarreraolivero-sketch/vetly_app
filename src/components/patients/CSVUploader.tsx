import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { Upload, FileSpreadsheet, X, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Database } from '@/types/database'

interface CSVUploaderProps {
    onSuccess: () => void;
}

type Step = 'idle' | 'preview' | 'importing' | 'done'

interface ParsedRow {
    patientName: string
    species: string | null
    breed: string | null
    sex: 'M' | 'F' | null
    color: string | null
    weight: number | null
    dob: string | null
    microchip: string | null
    tutorName: string | null
    phone: string | null
    email: string | null
    address: string | null
}

// Normaliza acentos/mayúsculas para hacer matching de encabezados y de valores
// de especie sin depender de que el archivo venga en un formato exacto.
const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const norm = (s: string) => stripAccents(s.toLowerCase().trim())

const findColumn = (headers: string[], keywords: string[], exclude: Set<number> = new Set()): number => {
    for (let i = 0; i < headers.length; i++) {
        if (exclude.has(i)) continue
        const h = norm(headers[i])
        if (keywords.some(k => h.includes(k))) return i
    }
    return -1
}

// Variantes en español (y algunas en inglés) de las especies más comunes,
// incluyendo animales mayores y exóticos -- antes el importador forzaba
// "Canino" para todo. Cualquier especie no reconocida se conserva tal cual
// viene en el archivo (capitalizada) en vez de perderse.
const SPECIES_MAP: Record<string, string> = {
    perro: 'Canino', perra: 'Canino', canino: 'Canino', can: 'Canino', dog: 'Canino',
    gato: 'Felino', gata: 'Felino', felino: 'Felino', cat: 'Felino',
    ave: 'Ave', gallina: 'Ave', gallo: 'Ave', loro: 'Ave', perico: 'Ave', canario: 'Ave', paloma: 'Ave', pato: 'Ave', ganso: 'Ave', bird: 'Ave',
    conejo: 'Conejo', coneja: 'Conejo', rabbit: 'Conejo',
    hamster: 'Roedor', jamster: 'Roedor', cuy: 'Roedor', cobaya: 'Roedor', chinchilla: 'Roedor', rata: 'Roedor', raton: 'Roedor', roedor: 'Roedor',
    iguana: 'Reptil', tortuga: 'Reptil', serpiente: 'Reptil', gecko: 'Reptil', lagarto: 'Reptil', reptil: 'Reptil',
    caballo: 'Equino', yegua: 'Equino', potro: 'Equino', equino: 'Equino', horse: 'Equino', mula: 'Equino', burro: 'Equino',
    vaca: 'Bovino', toro: 'Bovino', ternero: 'Bovino', ternera: 'Bovino', bovino: 'Bovino', res: 'Bovino', buey: 'Bovino',
    cerdo: 'Porcino', cerda: 'Porcino', chancho: 'Porcino', chancha: 'Porcino', marrano: 'Porcino', porcino: 'Porcino', cochino: 'Porcino',
    oveja: 'Ovino', cordero: 'Ovino', carnero: 'Ovino', ovino: 'Ovino',
    cabra: 'Caprino', chivo: 'Caprino', caprino: 'Caprino',
}

const normalizeSpecies = (raw: string): string | null => {
    const cleaned = raw.trim()
    if (!cleaned) return null
    const key = norm(cleaned)
    if (SPECIES_MAP[key]) return SPECIES_MAP[key]
    for (const [k, v] of Object.entries(SPECIES_MAP)) {
        if (key.includes(k)) return v
    }
    // Especie no reconocida (ej. "Llama", "Alpaca"): se conserva tal cual la
    // escribió el cliente en vez de forzarla a un valor genérico.
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

const normalizeSex = (raw: string): 'M' | 'F' | null => {
    const key = norm(raw)
    if (['m', 'macho', 'male'].includes(key)) return 'M'
    if (['f', 'h', 'hembra', 'female'].includes(key)) return 'F'
    return null
}

// Misma convención que el resto de la app (appointments.phone_number,
// tutors.phone_number): solo dígitos, sin "+", sin asumir código de país --
// Core ya tiene clínicas en Chile, México, Colombia y Perú, así que forzar un
// prefijo local sería incorrecto para la mayoría.
const normalizePhoneDigits = (raw: string): string | null => {
    const digits = raw.replace(/\D/g, '')
    return digits.length >= 7 ? digits : null
}

const parseWeight = (raw: string): number | null => {
    const n = parseFloat(raw.replace(',', '.').replace(/[^0-9.]/g, ''))
    return isNaN(n) ? null : n
}

const parseDob = (raw: string): string | null => {
    const cleaned = raw.trim()
    if (!cleaned) return null
    // dd/mm/yyyy o dd-mm-yyyy (formato más común en Latinoamérica)
    const m = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    if (m) {
        const [, d, mo, y] = m
        const date = new Date(Number(y), Number(mo) - 1, Number(d))
        if (!isNaN(date.getTime())) return date.toISOString().split('T')[0]
        return null
    }
    const date = new Date(cleaned)
    return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0]
}

export function CSVUploader({ onSuccess }: CSVUploaderProps) {
    const { profile } = useAuth();
    const [isOpen, setIsOpen] = useState(false)
    const [step, setStep] = useState<Step>('idle')
    const [error, setError] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [rows, setRows] = useState<ParsedRow[]>([])
    const [skippedCount, setSkippedCount] = useState(0)
    const [columnMap, setColumnMap] = useState<Record<string, string>>({})
    const [result, setResult] = useState<{ tutorsCreated: number; tutorsReused: number; patientsCreated: number; withoutTutor: number } | null>(null)

    const reset = () => {
        setIsOpen(false)
        setStep('idle')
        setError(null)
        setRows([])
        setSkippedCount(0)
        setColumnMap({})
        setResult(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.type !== 'text/csv' && !file.name.toLowerCase().endsWith('.csv')) {
            setError('Por favor sube un archivo CSV válido (exportado desde Excel o Google Sheets).');
            return;
        }

        setError(null)

        Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: h => h.trim(),
            complete: (results) => {
                const headers = results.meta.fields || []
                if (headers.length === 0) {
                    setError('El archivo está vacío o no tiene encabezados.')
                    return
                }

                const patientNameIdx = findColumn(headers, ['mascota', 'paciente', 'animal', 'pet'])
                const ownerNameIdx = findColumn(headers, ['propietario', 'dueno', 'tutor', 'cliente', 'owner'])
                const genericNameIdx = findColumn(headers, ['nombre', 'name'], new Set([ownerNameIdx].filter(i => i >= 0)))
                const finalPatientNameIdx = patientNameIdx >= 0 ? patientNameIdx : genericNameIdx

                const phoneIdx = findColumn(headers, ['telefono', 'telefonos', 'celular', 'contacto', 'whatsapp', 'movil', 'phone', 'cel', 'tel'])
                const emailIdx = findColumn(headers, ['correo', 'email', 'mail'])
                const addressIdx = findColumn(headers, ['direccion', 'domicilio', 'address'])
                const speciesIdx = findColumn(headers, ['especie', 'species', 'tipo'])
                const breedIdx = findColumn(headers, ['raza', 'breed'])
                const sexIdx = findColumn(headers, ['sexo', 'genero', 'sex'])
                const dobIdx = findColumn(headers, ['nacimiento', 'dob', 'birth'])
                const colorIdx = findColumn(headers, ['color'])
                const weightIdx = findColumn(headers, ['peso', 'weight'])
                const microchipIdx = findColumn(headers, ['microchip', 'chip'])

                if (finalPatientNameIdx === -1) {
                    setError('No se encontró una columna con el nombre del paciente (ej. "Nombre" o "Mascota").')
                    return
                }
                if (phoneIdx === -1) {
                    setError('No se encontró una columna con el teléfono del tutor (ej. "Teléfono" o "Celular").')
                    return
                }

                const detectedMap: Record<string, string> = { 'Nombre del paciente': headers[finalPatientNameIdx], 'Teléfono': headers[phoneIdx] }
                if (ownerNameIdx >= 0) detectedMap['Nombre del tutor'] = headers[ownerNameIdx]
                if (emailIdx >= 0) detectedMap['Correo'] = headers[emailIdx]
                if (addressIdx >= 0) detectedMap['Dirección'] = headers[addressIdx]
                if (speciesIdx >= 0) detectedMap['Especie'] = headers[speciesIdx]
                if (breedIdx >= 0) detectedMap['Raza'] = headers[breedIdx]
                if (sexIdx >= 0) detectedMap['Sexo'] = headers[sexIdx]
                if (dobIdx >= 0) detectedMap['Fecha de nacimiento'] = headers[dobIdx]
                if (colorIdx >= 0) detectedMap['Color'] = headers[colorIdx]
                if (weightIdx >= 0) detectedMap['Peso'] = headers[weightIdx]
                if (microchipIdx >= 0) detectedMap['Microchip'] = headers[microchipIdx]

                const parsed: ParsedRow[] = []
                let skipped = 0

                for (const rawRow of results.data) {
                    const get = (idx: number) => idx >= 0 ? (rawRow[headers[idx]] || '').trim() : ''

                    const patientName = get(finalPatientNameIdx)
                    if (!patientName) { skipped++; continue }

                    const speciesRaw = get(speciesIdx)
                    const sexRaw = get(sexIdx)

                    parsed.push({
                        patientName,
                        species: speciesRaw ? normalizeSpecies(speciesRaw) : null,
                        breed: get(breedIdx) || null,
                        sex: sexRaw ? normalizeSex(sexRaw) : null,
                        color: get(colorIdx) || null,
                        weight: weightIdx >= 0 ? parseWeight(get(weightIdx)) : null,
                        dob: dobIdx >= 0 ? parseDob(get(dobIdx)) : null,
                        microchip: get(microchipIdx) || null,
                        tutorName: get(ownerNameIdx) || null,
                        phone: normalizePhoneDigits(get(phoneIdx)),
                        email: get(emailIdx) || null,
                        address: get(addressIdx) || null,
                    })
                }

                if (parsed.length === 0) {
                    setError('No se encontró ningún paciente válido en el archivo (todas las filas están sin nombre).')
                    return
                }

                setRows(parsed)
                setSkippedCount(skipped)
                setColumnMap(detectedMap)
                setStep('preview')
            },
            error: (err) => {
                setError('No se pudo leer el archivo: ' + err.message)
            },
        })
    };

    const handleConfirmImport = async () => {
        if (!profile?.clinic_id) return
        setStep('importing')
        setError(null)

        try {
            const clinicId = profile.clinic_id

            // 1. Tutores: encontrar existentes por teléfono, crear los que falten.
            //    Dedup dentro del propio archivo por teléfono (varias mascotas
            //    del mismo dueño no deben crear tutores duplicados).
            const phoneToRowData = new Map<string, { name: string | null; email: string | null; address: string | null }>()
            for (const r of rows) {
                if (!r.phone) continue
                if (!phoneToRowData.has(r.phone)) {
                    phoneToRowData.set(r.phone, { name: r.tutorName, email: r.email, address: r.address })
                }
            }
            const uniquePhones = [...phoneToRowData.keys()]
            const phoneToTutorId = new Map<string, string>()

            const CHUNK = 150
            for (let i = 0; i < uniquePhones.length; i += CHUNK) {
                const batch = uniquePhones.slice(i, i + CHUNK)
                const { data: existing, error: existErr } = await supabase
                    .from('tutors')
                    .select('id, phone_number')
                    .eq('clinic_id', clinicId)
                    .in('phone_number', batch)
                if (existErr) throw existErr
                for (const t of (existing || [])) {
                    phoneToTutorId.set((t as any).phone_number, (t as any).id)
                }
            }

            const tutorsReused = phoneToTutorId.size
            const newTutorPhones = uniquePhones.filter(p => !phoneToTutorId.has(p))
            const newTutors: Database['public']['Tables']['tutors']['Insert'][] = newTutorPhones.map(phone => {
                const data = phoneToRowData.get(phone)!
                return {
                    clinic_id: clinicId,
                    phone_number: phone,
                    name: data.name,
                    email: data.email,
                    address: data.address,
                }
            })

            for (let i = 0; i < newTutors.length; i += CHUNK) {
                const batch = newTutors.slice(i, i + CHUNK)
                const { data: inserted, error: insertTutorErr } = await supabase
                    .from('tutors')
                    .insert(batch as any)
                    .select('id, phone_number')
                if (insertTutorErr) throw insertTutorErr
                for (const t of (inserted || [])) {
                    phoneToTutorId.set((t as any).phone_number, (t as any).id)
                }
            }

            // 2. Pacientes, ya con tutor_id resuelto.
            let withoutTutor = 0
            const patientsToInsert: Database['public']['Tables']['patients']['Insert'][] = rows.map(r => {
                const tutorId = r.phone ? phoneToTutorId.get(r.phone) || null : null
                if (!tutorId) withoutTutor++
                return {
                    clinic_id: clinicId,
                    tutor_id: tutorId,
                    name: r.patientName,
                    species: r.species,
                    breed: r.breed,
                    sex: r.sex,
                    color: r.color,
                    weight: r.weight,
                    dob: r.dob,
                    microchip_id: r.microchip,
                }
            })

            for (let i = 0; i < patientsToInsert.length; i += 250) {
                const batch = patientsToInsert.slice(i, i + 250)
                const { error: insertPatientsErr } = await supabase.from('patients').insert(batch as any)
                if (insertPatientsErr) throw insertPatientsErr
            }

            setResult({
                tutorsCreated: newTutors.length,
                tutorsReused,
                patientsCreated: patientsToInsert.length,
                withoutTutor,
            })
            setStep('done')
            onSuccess()
        } catch (err: any) {
            console.error('CSV Import Error:', err)
            setError(err.message || 'Error desconocido al importar el archivo')
            setStep('preview')
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="btn-ghost flex items-center gap-2 self-start sm:self-auto bg-white border border-silk-beige"
            >
                <Upload className="w-4 h-4 text-primary-500" />
                Importar CSV
            </button>

            {isOpen && (
                <ImportModal
                    step={step}
                    error={error}
                    rows={rows}
                    skippedCount={skippedCount}
                    columnMap={columnMap}
                    result={result}
                    fileInputRef={fileInputRef}
                    onFileUpload={handleFileUpload}
                    onConfirm={handleConfirmImport}
                    onClose={reset}
                    onBack={() => { setStep('idle'); setError(null) }}
                />
            )}
        </>
    );
}

// Modal separado del botón para no re-triggerear el <input type=file> al
// cerrarse -- el botón invisible de arriba solo abre el flujo.
function ImportModal({
    step, error, rows, skippedCount, columnMap, result, fileInputRef, onFileUpload, onConfirm, onClose, onBack,
}: {
    step: Step
    error: string | null
    rows: ParsedRow[]
    skippedCount: number
    columnMap: Record<string, string>
    result: { tutorsCreated: number; tutorsReused: number; patientsCreated: number; withoutTutor: number } | null
    fileInputRef: React.RefObject<HTMLInputElement>
    onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
    onConfirm: () => void
    onClose: () => void
    onBack: () => void
}) {
    const withPhone = rows.filter(r => r.phone).length

    return (
        <div className="fixed inset-0 bg-charcoal/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-silk-beige flex items-center justify-between sticky top-0 bg-white">
                    <div className="flex items-center gap-2">
                        {step === 'preview' && (
                            <button onClick={onBack} className="p-1.5 hover:bg-ivory rounded-full transition-colors">
                                <ArrowLeft className="w-4 h-4 text-gray-400" />
                            </button>
                        )}
                        <div>
                            <h3 className="text-xl font-bold text-charcoal flex items-center gap-2">
                                <FileSpreadsheet className="w-5 h-5 text-primary-500" />
                                Importar Pacientes
                            </h3>
                            <p className="text-sm text-gray-500 mt-1">
                                {step === 'idle' && 'Sube un Excel exportado como CSV.'}
                                {step === 'preview' && 'Revisa lo que detectamos antes de confirmar.'}
                                {step === 'importing' && 'Importando...'}
                                {step === 'done' && '¡Listo!'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-ivory rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {error && (
                        <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <p>{error}</p>
                        </div>
                    )}

                    {step === 'idle' && (
                        <>
                            <div className="bg-ivory p-4 rounded-xl border border-silk-beige border-dashed text-sm">
                                <p className="font-bold mb-2">Reglas del archivo:</p>
                                <ul className="list-disc list-inside space-y-1 text-gray-600">
                                    <li>Requiere una columna con el <strong>nombre del paciente</strong> y otra con el <strong>teléfono</strong> del tutor.</li>
                                    <li>Opcional: nombre del tutor, correo, dirección, especie, raza, sexo, color, peso, fecha de nacimiento, microchip.</li>
                                    <li>Reconoce especies exóticas y animales mayores (ave, conejo, equino, bovino, porcino, ovino, caprino, etc.) — si no reconoce el nombre, lo conserva tal cual.</li>
                                    <li>Formato CSV delimitado por comas (,) o punto y coma (;).</li>
                                </ul>
                            </div>

                            <div className="flex justify-center">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept=".csv,text/csv"
                                    onChange={onFileUpload}
                                    className="hidden"
                                    id="csv-upload"
                                />
                                <label
                                    htmlFor="csv-upload"
                                    className="w-full py-4 border-2 border-dashed border-primary-200 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all hover:bg-primary-50"
                                >
                                    <Upload className="w-6 h-6 text-primary-400" />
                                    <span className="text-charcoal font-medium">Click para seleccionar archivo</span>
                                </label>
                            </div>
                        </>
                    )}

                    {step === 'preview' && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-primary-50 rounded-xl text-center">
                                    <p className="text-2xl font-black text-primary-700">{rows.length}</p>
                                    <p className="text-[11px] font-bold text-primary-600 uppercase tracking-wide">Pacientes válidos</p>
                                </div>
                                <div className="p-3 bg-ivory rounded-xl text-center">
                                    <p className="text-2xl font-black text-charcoal">{withPhone}</p>
                                    <p className="text-[11px] font-bold text-charcoal/50 uppercase tracking-wide">Con teléfono</p>
                                </div>
                            </div>

                            {skippedCount > 0 && (
                                <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg">
                                    {skippedCount} fila{skippedCount !== 1 ? 's' : ''} se omitieron por no tener nombre de paciente.
                                </p>
                            )}
                            {rows.length > withPhone && (
                                <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg">
                                    {rows.length - withPhone} paciente{rows.length - withPhone !== 1 ? 's' : ''} sin teléfono válido — se crearán sin tutor vinculado.
                                </p>
                            )}

                            <div>
                                <p className="text-xs font-bold text-charcoal/50 uppercase tracking-wide mb-2">Columnas detectadas</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {Object.entries(columnMap).map(([field, col]) => (
                                        <span key={field} className="text-[11px] bg-ivory border border-silk-beige rounded-full px-2.5 py-1">
                                            <span className="text-charcoal/40">{field}:</span> <span className="font-bold text-charcoal">{col}</span>
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-bold text-charcoal/50 uppercase tracking-wide mb-2">Vista previa (primeras 5 filas)</p>
                                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                    {rows.slice(0, 5).map((r, i) => (
                                        <div key={i} className="text-xs bg-ivory rounded-lg p-2.5 flex items-center justify-between gap-2">
                                            <span className="font-bold text-charcoal truncate">{r.patientName}</span>
                                            <span className="text-charcoal/50 shrink-0">{r.species || 'sin especie'}{r.phone ? ` · ${r.phone}` : ' · sin tel.'}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button onClick={onConfirm} className="btn-primary w-full py-3">
                                Confirmar importación de {rows.length} paciente{rows.length !== 1 ? 's' : ''}
                            </button>
                        </>
                    )}

                    {step === 'importing' && (
                        <div className="flex flex-col items-center justify-center py-10 gap-3">
                            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-primary-600 font-bold">Importando pacientes y tutores...</p>
                        </div>
                    )}

                    {step === 'done' && result && (
                        <div className="space-y-4">
                            <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl text-sm flex items-start gap-3">
                                <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                <p className="font-bold">Importación completada</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-center">
                                <div className="p-3 bg-ivory rounded-xl"><p className="text-xl font-black text-charcoal">{result.patientsCreated}</p><p className="text-[11px] text-charcoal/50 uppercase font-bold">Pacientes creados</p></div>
                                <div className="p-3 bg-ivory rounded-xl"><p className="text-xl font-black text-charcoal">{result.tutorsCreated}</p><p className="text-[11px] text-charcoal/50 uppercase font-bold">Tutores nuevos</p></div>
                                <div className="p-3 bg-ivory rounded-xl"><p className="text-xl font-black text-charcoal">{result.tutorsReused}</p><p className="text-[11px] text-charcoal/50 uppercase font-bold">Tutores reutilizados</p></div>
                                <div className="p-3 bg-ivory rounded-xl"><p className="text-xl font-black text-charcoal">{result.withoutTutor}</p><p className="text-[11px] text-charcoal/50 uppercase font-bold">Sin tutor vinculado</p></div>
                            </div>
                            <button onClick={onClose} className="btn-primary w-full py-3">Cerrar</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
