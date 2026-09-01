import { useState, useRef, useCallback } from 'react'
import {
    X, Upload, Loader2, Sparkles, Stethoscope,
    CheckCircle2, AlertCircle, Trash2, FileSpreadsheet, ChevronRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import {
    parseSpreadsheet, chunkRows, groupByPatientTutor, matchPatientGroup,
    type ExtractedEvent, type RosterPatient, type PatientGroup,
} from './medicalHistoryImportHelpers'

const BATCH_SIZE = 50
const MAX_BATCHES = 40 // techo de 2000 filas por sesión — herramienta interna, no consumer-facing

const EVENT_TYPE_LABEL: Record<string, string> = {
    vaccine: 'Vacuna', deworming: 'Desparasitación', consultation: 'Consulta', unknown: 'Sin clasificar',
}

interface Props {
    clinicId: string
    clinicName: string
    onClose: () => void
    onSuccess: () => void
}

type Step = 'upload' | 'analyzing' | 'matching' | 'review' | 'saving' | 'done'

export function MedicalHistoryImportModal({ clinicId, clinicName, onClose, onSuccess }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const cancelRef = useRef(false)

    const [step, setStep] = useState<Step>('upload')
    const [dragOver, setDragOver] = useState(false)
    const [fileName, setFileName] = useState('')
    const [progress, setProgress] = useState({ current: 0, total: 0 })
    const [truncatedNote, setTruncatedNote] = useState<string | null>(null)

    const [roster, setRoster] = useState<RosterPatient[]>([])
    const [groups, setGroups] = useState<PatientGroup[]>([])
    const [events, setEvents] = useState<ExtractedEvent[]>([])

    const [saving, setSaving] = useState(false)
    const [result, setResult] = useState<{ vaccines_inserted: number; deworming_inserted: number; medical_history_inserted: number; skipped: any[]; errors: string[] } | null>(null)

    const reset = () => {
        setStep('upload'); setFileName(''); setProgress({ current: 0, total: 0 })
        setTruncatedNote(null); setGroups([]); setEvents([]); setResult(null)
        cancelRef.current = false
    }

    const fetchRoster = useCallback(async (): Promise<RosterPatient[]> => {
        const { data, error } = await supabase.functions.invoke('hq-clinic-patient-roster', {
            body: { clinic_id: clinicId },
        })
        if (error) throw new Error(error.message)
        if (data?.error) throw new Error(data.error)
        return data.patients ?? []
    }, [clinicId])

    const analyzeBatch = async (sheetName: string, rows: Record<string, string>[]): Promise<ExtractedEvent[]> => {
        const { data, error } = await supabase.functions.invoke('hq-analyze-medical-history', {
            body: { sheet_name: sheetName, rows },
        })
        if (error) throw new Error(error.message)
        if (data?.error) throw new Error(data.error)
        return (data.events ?? []).map((ev: any) => ({ ...ev, sheet_name: sheetName }))
    }

    const processFile = useCallback(async (file: File) => {
        const validExt = /\.(xlsx|xls|csv)$/i.test(file.name)
        if (!validExt) {
            toast.error('Solo se aceptan archivos .xlsx, .xls o .csv')
            return
        }

        setFileName(file.name)
        setStep('analyzing')
        cancelRef.current = false

        try {
            const rosterData = await fetchRoster()
            setRoster(rosterData)

            const sheets = await parseSpreadsheet(file)
            if (sheets.length === 0) {
                toast.error('El archivo no tiene filas con datos')
                reset()
                return
            }

            // Chunking por hoja — así cada lote tiene un sheet_name preciso.
            const allBatches: { sheetName: string; rows: Record<string, string>[] }[] = []
            for (const sheet of sheets) {
                for (const batch of chunkRows(sheet.rows, BATCH_SIZE)) {
                    allBatches.push({ sheetName: sheet.sheetName, rows: batch })
                }
            }

            let batchesToProcess = allBatches
            if (allBatches.length > MAX_BATCHES) {
                batchesToProcess = allBatches.slice(0, MAX_BATCHES)
                setTruncatedNote(`Se procesaron las primeras ${MAX_BATCHES * BATCH_SIZE} filas de un archivo más grande. Corre la herramienta de nuevo con el resto si hace falta.`)
            }

            setProgress({ current: 0, total: batchesToProcess.length })

            let allEvents: ExtractedEvent[] = []
            for (let i = 0; i < batchesToProcess.length; i++) {
                if (cancelRef.current) break
                setProgress({ current: i + 1, total: batchesToProcess.length })
                const batch = batchesToProcess[i]
                const batchEvents = await analyzeBatch(batch.sheetName, batch.rows)
                allEvents = [...allEvents, ...batchEvents]
            }

            if (cancelRef.current) {
                toast('Análisis cancelado', { icon: 'ℹ️' })
                reset()
                return
            }

            const grouped = groupByPatientTutor(allEvents).map(g => matchPatientGroup(g, rosterData))
            setGroups(grouped)
            setEvents(allEvents)
            setStep('matching')
        } catch (err: any) {
            toast.error(err.message ?? 'Error al analizar el archivo')
            reset()
        }
    }, [fetchRoster])

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) processFile(file)
    }
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) processFile(file)
    }
    const handleCancelAnalysis = () => { cancelRef.current = true }

    const setGroupPatient = (groupKey: string, patientId: string | null) => {
        setGroups(prev => prev.map(g => g.key === groupKey ? { ...g, resolvedPatientId: patientId } : g))
    }

    const proceedToReview = () => {
        // Cada evento ya vive dentro de exactamente un grupo (groupByPatientTutor
        // los reparte sin solapar) — se busca por identidad de objeto, no hace
        // falta reconstruir la key de normalización acá.
        const resolved = events.map(ev => {
            const g = groups.find(gr => gr.events.includes(ev))
            return { ...ev, patient_id: g?.resolvedPatientId ?? null, selected: !!g?.resolvedPatientId }
        })
        setEvents(resolved)
        setStep('review')
    }

    const toggleEvent = (idx: number) =>
        setEvents(prev => prev.map((ev, i) => i === idx ? { ...ev, selected: !ev.selected } : ev))
    const updateEvent = (idx: number, field: keyof ExtractedEvent, value: any) =>
        setEvents(prev => prev.map((ev, i) => i === idx ? { ...ev, [field]: value } : ev))
    const removeEvent = (idx: number) =>
        setEvents(prev => prev.filter((_, i) => i !== idx))

    const isEventValid = (ev: ExtractedEvent) => {
        if (!ev.patient_id) return false
        if (ev.event_type === 'vaccine') return !!ev.vaccine_name && !!ev.application_date
        if (ev.event_type === 'deworming') return !!ev.deworming_type && !!ev.application_date
        if (ev.event_type === 'consultation') return true
        return false
    }

    const selectedEvents = events.filter(ev => ev.selected)
    const selectedInvalidCount = selectedEvents.filter(ev => !isEventValid(ev)).length

    const handleConfirm = async () => {
        if (selectedEvents.length === 0) { toast.error('Selecciona al menos un evento'); return }
        if (selectedInvalidCount > 0) { toast.error(`${selectedInvalidCount} evento(s) seleccionados tienen campos obligatorios vacíos (en rojo)`); return }

        setStep('saving')
        setSaving(true)
        try {
            const { data, error } = await supabase.functions.invoke('hq-commit-medical-history', {
                body: {
                    clinic_id: clinicId,
                    events: selectedEvents.map(ev => ({
                        event_type: ev.event_type,
                        patient_id: ev.patient_id,
                        vaccine_name: ev.vaccine_name,
                        deworming_type: ev.deworming_type,
                        deworming_brand: ev.deworming_brand,
                        weight: ev.weight,
                        application_date: ev.application_date,
                        next_dose_date: ev.next_dose_date,
                        reason: ev.reason,
                        diagnosis: ev.diagnosis,
                        anamnesis: ev.anamnesis,
                        procedure_notes: ev.procedure_notes,
                        event_date: ev.event_date,
                        notes: ev.notes,
                    })),
                },
            })
            if (error) throw new Error(error.message)
            if (data?.error) throw new Error(data.error)
            setResult(data)
            setStep('done')
            onSuccess()
        } catch (err: any) {
            toast.error(err.message ?? 'Error al guardar el historial')
            setStep('review')
        } finally {
            setSaving(false)
        }
    }

    const patientLabel = (id: string | null | undefined) => {
        if (!id) return '—'
        const p = roster.find(r => r.id === id)
        return p ? `${p.name}${p.tutor_name ? ` (${p.tutor_name})` : ''}` : id
    }

    return (
        <div className="fixed inset-0 bg-charcoal/50 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-silk-beige shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-violet-100 rounded-xl flex items-center justify-center">
                            <Stethoscope className="w-5 h-5 text-violet-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-charcoal">Importar historial médico</h3>
                            <p className="text-xs text-charcoal/50">{clinicName} · vacunas, desparasitaciones y consultas</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-silk-beige rounded-soft transition-colors">
                        <X className="w-5 h-5 text-charcoal/50" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">

                    {/* ── UPLOAD ─────────────────────────────────────── */}
                    {step === 'upload' && (
                        <div className="p-8">
                            <div
                                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={cn(
                                    "border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all",
                                    dragOver ? "border-violet-400 bg-violet-50" : "border-silk-beige hover:border-violet-300 hover:bg-violet-50/30"
                                )}
                            >
                                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
                                <div className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                    <Upload className="w-8 h-8 text-violet-500" />
                                </div>
                                <p className="text-base font-bold text-charcoal mb-1">Arrastra el Excel del cliente aquí</p>
                                <p className="text-sm text-charcoal/50 mb-4">o haz clic para seleccionar un archivo</p>
                                <div className="flex items-center justify-center gap-3 text-xs text-charcoal/40">
                                    <span className="flex items-center gap-1"><FileSpreadsheet className="w-3.5 h-3.5" /> XLSX / XLS / CSV</span>
                                    <span>·</span>
                                    <span>varias hojas OK</span>
                                </div>
                            </div>

                            <div className="mt-6 bg-violet-50 rounded-xl p-4 border border-violet-100">
                                <p className="text-xs font-bold text-violet-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5" /> Cómo funciona
                                </p>
                                <ol className="text-sm text-charcoal/70 space-y-1 list-decimal list-inside">
                                    <li>Requiere que el roster de pacientes/tutores ya esté importado (CSVUploader) en esta clínica</li>
                                    <li>La IA lee el Excel y extrae vacunas, desparasitaciones y consultas</li>
                                    <li>Vas a poder confirmar a qué paciente corresponde cada grupo de eventos</li>
                                    <li>Revisas y corriges cada evento antes de guardar — nada se guarda sin tu confirmación</li>
                                </ol>
                            </div>
                        </div>
                    )}

                    {/* ── ANALYZING ──────────────────────────────────── */}
                    {step === 'analyzing' && (
                        <div className="p-12 flex flex-col items-center gap-6">
                            <div className="w-20 h-20 bg-violet-50 rounded-2xl flex flex-col items-center justify-center border border-violet-100">
                                <FileSpreadsheet className="w-8 h-8 text-violet-400" />
                            </div>
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-14 h-14 bg-violet-100 rounded-2xl flex items-center justify-center">
                                    <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
                                </div>
                                <p className="text-base font-bold text-charcoal">
                                    {progress.total > 0 ? `Analizando lote ${progress.current} de ${progress.total}...` : 'Preparando...'}
                                </p>
                                <p className="text-sm text-charcoal/40 max-w-xs truncate">{fileName}</p>
                            </div>
                            <button onClick={handleCancelAnalysis} className="text-xs text-red-500 hover:text-red-600 underline">
                                Cancelar
                            </button>
                        </div>
                    )}

                    {/* ── MATCHING (por grupo paciente/tutor) ───────────── */}
                    {step === 'matching' && (
                        <div className="p-6 space-y-4">
                            {truncatedNote && (
                                <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
                                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                                    <p className="text-xs text-amber-700">{truncatedNote}</p>
                                </div>
                            )}
                            <p className="text-sm text-charcoal/60">
                                Se detectaron <strong>{groups.length}</strong> pacientes distintos en el archivo, con <strong>{events.length}</strong> eventos en total. Confirma a qué paciente de Vetly corresponde cada uno.
                            </p>
                            <div className="border border-silk-beige rounded-xl divide-y divide-silk-beige/50 max-h-[50vh] overflow-y-auto">
                                {groups.map(g => (
                                    <div key={g.key} className="p-4 flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-charcoal truncate">
                                                {g.patientNameRaw} {g.tutorNameRaw && <span className="text-charcoal/40 font-normal">· {g.tutorNameRaw}</span>}
                                            </p>
                                            <p className="text-xs text-charcoal/40">{g.events.length} evento{g.events.length !== 1 ? 's' : ''}</p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {g.matchStatus === 'auto' && (
                                                <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                                    <CheckCircle2 className="w-3.5 h-3.5" /> {patientLabel(g.resolvedPatientId)}
                                                </span>
                                            )}
                                            {(g.matchStatus === 'ambiguous' || g.matchStatus === 'no_match') && (
                                                <select
                                                    value={g.resolvedPatientId ?? ''}
                                                    onChange={e => setGroupPatient(g.key, e.target.value || null)}
                                                    className={cn(
                                                        "text-xs rounded-lg border px-2 py-1.5 max-w-[220px]",
                                                        g.resolvedPatientId ? "border-emerald-200 text-emerald-700" : "border-amber-300 text-amber-700 bg-amber-50"
                                                    )}
                                                >
                                                    <option value="">
                                                        {g.matchStatus === 'no_match' ? 'Sin match — elegir manual' : `Ambiguo (${g.candidates.length}) — elegir`}
                                                    </option>
                                                    {(g.candidates.length > 0 ? g.candidates : roster).map(c => (
                                                        <option key={c.id} value={c.id}>{c.name}{c.tutor_name ? ` (${c.tutor_name})` : ''}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button onClick={proceedToReview} className="btn-primary flex items-center gap-2">
                                Continuar a revisión <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {/* ── REVIEW ─────────────────────────────────────── */}
                    {step === 'review' && (
                        <div className="p-6 space-y-4">
                            <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                <span className="text-xs text-emerald-600 font-medium">
                                    {selectedEvents.length} de {events.length} eventos seleccionados
                                    {selectedInvalidCount > 0 && ` · ${selectedInvalidCount} con campos obligatorios vacíos (en rojo)`}
                                </span>
                            </div>
                            <div className="border border-silk-beige rounded-xl overflow-hidden">
                                <div className="bg-silk-beige/30 px-4 py-2.5 grid grid-cols-[auto_90px_1fr_1fr_100px_100px_1fr_32px] gap-2 text-[10px] font-black uppercase tracking-wider text-charcoal/50">
                                    <span>✓</span><span>Tipo</span><span>Paciente</span><span>Campo</span><span>Fecha</span><span>Próx. dosis</span><span>Notas</span><span />
                                </div>
                                <div className="divide-y divide-silk-beige/50 max-h-[45vh] overflow-y-auto">
                                    {events.map((ev, idx) => {
                                        const invalid = ev.selected && !isEventValid(ev)
                                        const mainField = ev.event_type === 'vaccine' ? 'vaccine_name' : ev.event_type === 'deworming' ? 'deworming_type' : 'diagnosis'
                                        return (
                                            <div key={idx} className={cn(
                                                "px-4 py-2.5 grid grid-cols-[auto_90px_1fr_1fr_100px_100px_1fr_32px] gap-2 items-center text-xs",
                                                !ev.selected && "opacity-40",
                                                invalid && "bg-red-50"
                                            )}>
                                                <input type="checkbox" checked={!!ev.selected} onChange={() => toggleEvent(idx)} className="w-4 h-4 accent-primary-500 cursor-pointer" />
                                                <span className="text-charcoal/60">{EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}</span>
                                                <span className="truncate" title={patientLabel(ev.patient_id)}>{patientLabel(ev.patient_id) || <span className="text-red-500">sin match</span>}</span>
                                                <input
                                                    value={(ev as any)[mainField] ?? ''}
                                                    onChange={e => updateEvent(idx, mainField as keyof ExtractedEvent, e.target.value)}
                                                    className="bg-transparent border border-silk-beige rounded px-1 py-0.5 truncate"
                                                />
                                                <input
                                                    type="date"
                                                    value={(ev.application_date || ev.event_date || '') as string}
                                                    onChange={e => updateEvent(idx, ev.event_type === 'consultation' ? 'event_date' : 'application_date', e.target.value)}
                                                    className="bg-transparent border border-silk-beige rounded px-1 py-0.5"
                                                />
                                                <input
                                                    type="date"
                                                    value={ev.next_dose_date ?? ''}
                                                    onChange={e => updateEvent(idx, 'next_dose_date', e.target.value)}
                                                    disabled={ev.event_type === 'consultation'}
                                                    className="bg-transparent border border-silk-beige rounded px-1 py-0.5 disabled:opacity-30"
                                                />
                                                <input
                                                    value={ev.notes ?? ''}
                                                    onChange={e => updateEvent(idx, 'notes', e.target.value)}
                                                    className="bg-transparent border border-silk-beige rounded px-1 py-0.5 truncate"
                                                />
                                                <button onClick={() => removeEvent(idx)} className="text-red-400 hover:text-red-500 flex items-center justify-center">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                            <button onClick={() => setStep('matching')} className="text-xs text-charcoal/40 hover:text-charcoal underline">
                                ← Volver a matching
                            </button>
                        </div>
                    )}

                    {/* ── SAVING ─────────────────────────────────────── */}
                    {step === 'saving' && (
                        <div className="p-12 flex flex-col items-center gap-4">
                            <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
                            <p className="text-base font-bold text-charcoal">Guardando historial médico...</p>
                        </div>
                    )}

                    {/* ── DONE ───────────────────────────────────────── */}
                    {step === 'done' && result && (
                        <div className="p-8 flex flex-col items-center gap-4 text-center">
                            <CheckCircle2 className="w-14 h-14 text-emerald-500" />
                            <p className="text-lg font-bold text-charcoal">Historial importado</p>
                            <div className="text-sm text-charcoal/60 space-y-1">
                                <p>{result.vaccines_inserted} vacunas · {result.deworming_inserted} desparasitaciones · {result.medical_history_inserted} consultas</p>
                                {result.skipped.length > 0 && <p className="text-amber-600">{result.skipped.length} eventos omitidos (ver detalle abajo)</p>}
                                {result.errors.length > 0 && <p className="text-red-500">{result.errors.length} error(es) — revisa con el equipo técnico</p>}
                            </div>
                            {result.skipped.length > 0 && (
                                <div className="text-left w-full bg-amber-50 rounded-xl p-3 border border-amber-100 max-h-40 overflow-y-auto">
                                    {result.skipped.map((s, i) => (
                                        <p key={i} className="text-xs text-amber-700">Fila {s.index}: {s.reason}</p>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-silk-beige shrink-0 flex justify-end gap-3 bg-ivory rounded-b-2xl">
                    <button onClick={onClose} className="btn-ghost">{step === 'done' ? 'Cerrar' : 'Cancelar'}</button>
                    {step === 'review' && (
                        <button onClick={handleConfirm} disabled={saving || selectedEvents.length === 0} className="btn-primary disabled:opacity-50 flex items-center gap-2">
                            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : <><Stethoscope className="w-4 h-4" /> Guardar {selectedEvents.length} eventos</>}
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
