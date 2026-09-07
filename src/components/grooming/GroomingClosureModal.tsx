import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Scissors, Plus, Trash2, Camera, Check } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'react-hot-toast'
import { groomingService, type GroomingSessionServiceLine } from '@/services/groomingService'

interface Props {
    patient: { id: string; name: string; clinic_id: string; breed?: string | null; weight?: number | null }
    tutor?: { id: string; name?: string | null } | null
    appointmentId?: string | null
    existingSessionId?: string | null
    size?: string | null
    coat?: string | null
    groomers: { member_id: string; first_name?: string; last_name?: string }[]
    currency?: string
    onClose: () => void
    onSaved: () => void
}

interface Line extends GroomingSessionServiceLine { localId: string }
const uid = () => Math.random().toString(36).slice(2)
const PAYMENT_METHODS = ['efectivo', 'transferencia', 'tarjeta_credito', 'tarjeta_debito']
const PM_LABEL: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta_credito: 'Tarjeta crédito', tarjeta_debito: 'Tarjeta débito' }

export function GroomingClosureModal({ patient, tutor, appointmentId, existingSessionId, size, coat, groomers, currency = 'CLP', onClose, onSaved }: Props) {
    const { profile, member } = useAuth()
    const [services, setServices] = useState<any[]>([])
    const [lines, setLines] = useState<Line[]>([])
    const [findings, setFindings] = useState('')
    const [productsUsed, setProductsUsed] = useState('')
    const [nextWeeks, setNextWeeks] = useState<number | ''>('')
    const [groomerId, setGroomerId] = useState<string>(member?.id || '')
    const [notes, setNotes] = useState('')
    const [beforeFiles, setBeforeFiles] = useState<File[]>([])
    const [afterFiles, setAfterFiles] = useState<File[]>([])
    const [charge, setCharge] = useState(true)
    const [discount, setDiscount] = useState<number>(0)
    const [paymentMethod, setPaymentMethod] = useState('efectivo')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [addServiceId, setAddServiceId] = useState('')

    useEffect(() => {
        ;(async () => {
            const svcs = await groomingService.getGroomingServices(patient.clinic_id)
            setServices(svcs)
            if (existingSessionId) {
                const sessions = await groomingService.getSessions(patient.id)
                const s = sessions.find(x => x.id === existingSessionId)
                if (s) {
                    setLines((s.services || []).map(sv => ({ ...sv, localId: uid() })))
                    setFindings(s.findings || '')
                    setProductsUsed(s.products_used || '')
                    setNextWeeks(s.next_visit_weeks ?? '')
                    setGroomerId(s.groomer_member_id || member?.id || '')
                    setNotes(s.notes || '')
                }
            }
            setLoading(false)
        })()
    }, [patient.id, patient.clinic_id, existingSessionId])

    const addService = async () => {
        const svc = services.find(s => s.id === addServiceId)
        if (!svc) return
        const resolved = await groomingService.priceLookup(svc.id, size, coat, patient.weight ?? null, patient.breed ?? null)
        setLines(l => [...l, { localId: uid(), name: svc.name, price: resolved ?? Number(svc.price) ?? 0, add_on: false }])
        setAddServiceId('')
    }

    const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.price) || 0), 0), [lines])
    const finalTotal = Math.max(0, total - (Number(discount) || 0))
    const fmt = (n: number) => currency === 'CLP' ? `$${Math.round(n).toLocaleString('es-CL')}` : `$${n.toFixed(2)}`

    const handleSave = async () => {
        if (lines.length === 0 && !findings.trim()) {
            toast.error('Agrega al menos un servicio o una observación.')
            return
        }
        setSaving(true)
        try {
            // 1. crea/actualiza la sesión (sin fotos aún — necesitamos el id)
            const sessionId = await groomingService.saveSession({
                sessionId: existingSessionId,
                clinicId: patient.clinic_id,
                patientId: patient.id,
                patientName: patient.name,
                appointmentId: appointmentId ?? null,
                groomerMemberId: groomerId || null,
                tutorId: tutor?.id || null,
                services: lines.map(({ localId: _localId, ...rest }) => rest),
                findings: findings.trim() || null,
                beforePhotos: [],
                afterPhotos: [],
                productsUsed: productsUsed.trim() || null,
                nextVisitWeeks: nextWeeks === '' ? null : Number(nextWeeks),
                notes: notes.trim() || null,
                charge: charge ? { total: finalTotal, discount: Number(discount) || 0, paymentMethod } : null,
                currency,
                createdBy: profile?.id || null,
            })

            // 2. sube las fotos y actualiza la sesión con las URLs
            if (beforeFiles.length || afterFiles.length) {
                const [before, after] = await Promise.all([
                    beforeFiles.length ? groomingService.uploadPhotos(patient.clinic_id, patient.id, sessionId, 'before', beforeFiles) : Promise.resolve([]),
                    afterFiles.length ? groomingService.uploadPhotos(patient.clinic_id, patient.id, sessionId, 'after', afterFiles) : Promise.resolve([]),
                ])
                await groomingService.saveSession({
                    sessionId,
                    clinicId: patient.clinic_id,
                    patientId: patient.id,
                    patientName: patient.name,
                    appointmentId: null,   // ya se marcó completed en el paso 1
                    groomerMemberId: groomerId || null,
                    services: lines.map(({ localId: _l, ...rest }) => rest),
                    findings: findings.trim() || null,
                    beforePhotos: before,
                    afterPhotos: after,
                    productsUsed: productsUsed.trim() || null,
                    nextVisitWeeks: nextWeeks === '' ? null : Number(nextWeeks),
                    notes: notes.trim() || null,
                    charge: null,   // el cobro ya se registró en el paso 1
                })
            }

            toast.success('Sesión de estética guardada')
            onSaved()
        } catch (e: any) {
            toast.error(e.message || 'No se pudo guardar la sesión')
        } finally {
            setSaving(false)
        }
    }

    return createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[99999] p-4 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
                <div className="p-5 border-b border-silk-beige flex items-center justify-between bg-primary-50/50 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center"><Scissors className="w-5 h-5 text-primary-600" /></div>
                        <div>
                            <h3 className="font-bold text-charcoal">Cerrar sesión de estética</h3>
                            <p className="text-xs text-charcoal/50">{patient.name}{tutor?.name ? ` — ${tutor.name}` : ''}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-silk-beige rounded-lg"><X className="w-5 h-5 text-charcoal/60" /></button>
                </div>

                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
                ) : (
                    <div className="p-5 overflow-y-auto flex-1 space-y-4">
                        {/* Peluquero */}
                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Peluquero/a</label>
                            <select value={groomerId} onChange={e => setGroomerId(e.target.value)} className="input-soft w-full mt-1">
                                <option value="">—</option>
                                {groomers.map(g => <option key={g.member_id} value={g.member_id}>{[g.first_name, g.last_name].filter(Boolean).join(' ')}</option>)}
                            </select>
                        </div>

                        {/* Servicios */}
                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Servicios realizados</label>
                            <div className="flex gap-2 mt-1">
                                <select value={addServiceId} onChange={e => setAddServiceId(e.target.value)} className="input-soft flex-1">
                                    <option value="">Agregar servicio de estética…</option>
                                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                                <button onClick={addService} disabled={!addServiceId} className="btn-ghost px-3 disabled:opacity-40"><Plus className="w-4 h-4" /></button>
                            </div>
                            <div className="space-y-1.5 mt-2">
                                {lines.map(l => (
                                    <div key={l.localId} className="flex items-center gap-2 text-sm">
                                        <input value={l.name} onChange={e => setLines(ls => ls.map(x => x.localId === l.localId ? { ...x, name: e.target.value } : x))} className="input-soft py-1 flex-1 text-xs" />
                                        <label className="flex items-center gap-1 text-[11px] text-charcoal/50 shrink-0">
                                            <input type="checkbox" checked={!!l.add_on} onChange={e => setLines(ls => ls.map(x => x.localId === l.localId ? { ...x, add_on: e.target.checked } : x))} /> adicional
                                        </label>
                                        <input type="number" value={l.price} onChange={e => setLines(ls => ls.map(x => x.localId === l.localId ? { ...x, price: Number(e.target.value) || 0 } : x))} className="input-soft py-1 text-xs w-24" />
                                        <button onClick={() => setLines(ls => ls.filter(x => x.localId !== l.localId))} className="p-1 text-charcoal/30 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Fotos */}
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-bold text-charcoal/60 flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> Fotos antes</label>
                                <input type="file" accept="image/*" multiple onChange={e => setBeforeFiles(Array.from(e.target.files || []))} className="mt-1 text-xs w-full" />
                                {beforeFiles.length > 0 && <p className="text-[11px] text-emerald-600 mt-1">{beforeFiles.length} foto(s)</p>}
                            </div>
                            <div>
                                <label className="text-xs font-bold text-charcoal/60 flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> Fotos después</label>
                                <input type="file" accept="image/*" multiple onChange={e => setAfterFiles(Array.from(e.target.files || []))} className="mt-1 text-xs w-full" />
                                {afterFiles.length > 0 && <p className="text-[11px] text-emerald-600 mt-1">{afterFiles.length} foto(s)</p>}
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Observaciones y hallazgos</label>
                            <textarea value={findings} onChange={e => setFindings(e.target.value)} rows={3} className="input-soft w-full mt-1 resize-y" placeholder="Pulgas, garrapatas, otitis, bultos, estado de la piel, uñas…" />
                        </div>

                        <div className="grid sm:grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-bold text-charcoal/60">Productos usados</label>
                                <input value={productsUsed} onChange={e => setProductsUsed(e.target.value)} className="input-soft w-full mt-1" />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-charcoal/60">Próxima visita en (semanas)</label>
                                <input type="number" value={nextWeeks} onChange={e => setNextWeeks(e.target.value === '' ? '' : Number(e.target.value))} className="input-soft w-full mt-1" placeholder="ej. 6" />
                            </div>
                        </div>

                        {/* Cobro */}
                        <div className="p-3 rounded-xl bg-ivory/60 border border-silk-beige space-y-2">
                            <label className="flex items-center gap-2 text-sm font-bold text-charcoal">
                                <input type="checkbox" checked={charge} onChange={e => setCharge(e.target.checked)} /> Registrar cobro
                            </label>
                            {charge && (
                                <div className="grid sm:grid-cols-3 gap-2 text-sm">
                                    <div>
                                        <label className="text-[11px] font-bold text-charcoal/50">Descuento</label>
                                        <input type="number" value={discount} onChange={e => setDiscount(Number(e.target.value) || 0)} className="input-soft py-1 w-full text-xs" />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-bold text-charcoal/50">Método de pago</label>
                                        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="input-soft py-1 w-full text-xs">
                                            {PAYMENT_METHODS.map(p => <option key={p} value={p}>{PM_LABEL[p]}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex flex-col justify-end">
                                        <p className="text-[11px] font-bold text-charcoal/50">Total a cobrar</p>
                                        <p className="text-lg font-black text-primary-700">{fmt(finalTotal)}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Notas internas (no van al reporte del tutor)</label>
                            <input value={notes} onChange={e => setNotes(e.target.value)} className="input-soft w-full mt-1" />
                        </div>
                    </div>
                )}

                <div className="p-4 border-t border-silk-beige flex justify-end gap-2 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-charcoal/60 hover:bg-charcoal/5">Cancelar</button>
                    <button onClick={handleSave} disabled={saving || loading} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar sesión
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}
