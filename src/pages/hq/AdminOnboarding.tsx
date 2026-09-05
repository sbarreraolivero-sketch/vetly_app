import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, RefreshCw, ClipboardList, ChevronDown, ChevronRight, FileDown, Paperclip } from 'lucide-react'

interface OnboardingRow {
    id: string
    created_at: string
    clinic_name: string | null
    contact_name: string | null
    contact_email: string | null
    contact_phone: string | null
    country: string | null
    city: string | null
    submission: Record<string, any>
    source: string
    status: string
}

interface StoredFile { name: string; url: string }

// Etiquetas legibles para las claves del formulario. Las que no estén acá
// se muestran humanizando el nombre (guiones bajos → espacios).
const LABELS: Record<string, string> = {
    clinic_name: 'Nombre de la clínica', country: 'País', city: 'Ciudad', currency: 'Moneda',
    address: 'Dirección', clinic_phone: 'Teléfono clínica', contact_email: 'Email de contacto',
    website: 'Sitio web', social: 'Instagram / Facebook', owner: 'Dueño/a', brand_color: 'Color de marca',
    hours: 'Horario día por día', last_slot: 'Última hora agendable', service_hours: 'Servicios con horario restringido',
    scheduling_mode: 'Modo de agendamiento', scheduler_person: 'Persona que confirma citas',
    services_need_prior: 'Servicios con consulta/evaluación previa', confirm_reminders: 'Qué recuerda el agente al confirmar',
    consult_general: 'Consulta general', consult_control: 'Controles', consult_urgency: 'Consulta de urgencia',
    consult_multi: 'Consulta con varias mascotas',
    vac_dogs: 'Vacunas perros', vac_cats: 'Vacunas gatos', vac_puppy_scheme: 'Esquema cachorros',
    vac_adult_scheme: 'Esquema adultos vacunados', vac_adult_unvaccinated: 'Adulto nunca vacunado',
    vac_first_time: 'Primera vacunación (1 o 2 vacunas)', vac_combos: 'Combinaciones de vacunas permitidas/prohibidas',
    vac_requirements: 'Requisitos y seguridad para vacunar', vac_felv_test: 'Test FeLV / FIV',
    vac_packs: 'Packs y promociones de vacunación', vac_includes: 'Qué incluye el valor de una vacuna',
    deworm_internal: 'Desparasitación interna', deworm_external: 'Desparasitación externa',
    deworm_frequency: 'Frecuencia por edad', deworm_flow: 'Flujo de agendamiento desparasitación',
    surg_prices: 'Precios esterilización/castración', surg_prior_consult: 'Consulta previa antes de operar',
    surg_preop_exams: 'Exámenes prequirúrgicos', surg_fasting: 'Ayuno y preparación',
    surg_surcharges: 'Recargos y condiciones especiales', surg_exclusions: 'Razas/casos que no operan',
    surg_day_logistics: 'Logística del día de la cirugía', surg_scheduling: 'Cómo se agenda una cirugía',
    surg_other: 'Otras cirugías', surg_alizin: 'Interrupción de gestación / monta no deseada',
    dental_prices: 'Precios destartraje', dental_prior_eval: 'Consulta de evaluación previa',
    dental_anesthesia: 'Anestesia, ayuno y exámenes', dental_scheduling: 'Cómo se agenda el destartraje',
    lab_list: 'Exámenes y precios', lab_referrals: 'Exámenes derivados a lab externo',
    lab_order_required: 'Exigen orden médica', lab_prep: 'Ayuno y preparación exámenes', lab_turnaround: 'Plazo de resultados',
    imaging: 'Imagenología (eco / rayos X)',
    svc_nails: 'Corte de uñas', svc_microchip: 'Microchip', svc_certificate: 'Certificado de salud/viaje',
    svc_euthanasia: 'Eutanasia', svc_cremation: 'Cremación', svc_grooming: 'Peluquería / baño',
    svc_hospitalization: 'Hospitalización', svc_other: 'Otros servicios', full_price_list: 'Lista de precios completa',
    species: 'Especies que atiende', pol_emergencies: 'Mascotas enfermas y urgencias', pol_dont_do: 'Qué NO hace la clínica',
    pol_payment: 'Métodos de pago', pol_late: 'Tolerancia de atraso', pol_deposit: 'Seña para cirugías',
    pol_noshow: 'Política de no-show y cancelación', pol_invoicing: 'Facturación electrónica',
    pol_discounts: 'Descuentos y convenios', pol_transfer_data: 'Datos para transferencia',
    wa_number: 'Número de WhatsApp', wa_is_business: '¿Ya es WhatsApp Business?', wa_has_meta: '¿Tiene Business Manager de Meta?',
    wa_volume: 'Volumen de mensajes/día', wa_who: 'Quién responde hoy', agent_name: 'Nombre del agente',
    agent_treatment: 'Tratamiento al cliente', agent_accent: 'Acento, región y modismos', agent_tone: 'Tono del agente',
    agent_greeting: 'Mensaje de bienvenida', agent_donts: 'Qué NO debe hacer el agente', agent_faqs: 'Preguntas frecuentes',
    agent_directions: 'Cómo llegar / estacionamiento', agent_home_visits: 'Visitas a domicilio',
    rem_24h: 'Recordatorio 24 h', rem_2h: 'Recordatorio 2 h', rem_medical: 'Recordatorios médicos', rem_text: 'Texto de recordatorios',
    mig_system: 'Sistema actual', mig_exportable: 'Exportable a Excel/CSV', mig_patients: 'Pacientes activos', mig_appts: 'Citas por mes',
    loyalty_interest: 'Interés en fidelización', loyalty_current: 'Programa actual de fidelización',
    anything_else: 'Algo más', source: 'Origen', submitted_at: 'Enviado', user_agent: 'Navegador', file_count: 'Archivos adjuntos',
}

const SECTIONS: { title: string; keys: string[] }[] = [
    { title: 'Datos de la clínica', keys: ['clinic_name', 'country', 'city', 'currency', 'address', 'clinic_phone', 'contact_email', 'website', 'social', 'owner', 'brand_color'] },
    { title: 'Horarios', keys: ['hours', 'last_slot', 'service_hours'] },
    { title: 'Cómo agenda el agente', keys: ['scheduling_mode', 'scheduler_person', 'services_need_prior', 'confirm_reminders'] },
    { title: 'Consultas médicas', keys: ['consult_general', 'consult_control', 'consult_urgency', 'consult_multi'] },
    { title: 'Vacunación', keys: ['vac_dogs', 'vac_cats', 'vac_puppy_scheme', 'vac_adult_scheme', 'vac_adult_unvaccinated', 'vac_first_time', 'vac_combos', 'vac_requirements', 'vac_felv_test', 'vac_packs', 'vac_includes'] },
    { title: 'Desparasitación', keys: ['deworm_internal', 'deworm_external', 'deworm_frequency', 'deworm_flow'] },
    { title: 'Cirugías y esterilizaciones', keys: ['surg_prices', 'surg_prior_consult', 'surg_preop_exams', 'surg_fasting', 'surg_surcharges', 'surg_exclusions', 'surg_day_logistics', 'surg_scheduling', 'surg_other', 'surg_alizin'] },
    { title: 'Destartraje', keys: ['dental_prices', 'dental_prior_eval', 'dental_anesthesia', 'dental_scheduling'] },
    { title: 'Laboratorio', keys: ['lab_list', 'lab_referrals', 'lab_order_required', 'lab_prep', 'lab_turnaround'] },
    { title: 'Imagenología', keys: ['imaging'] },
    { title: 'Otros servicios', keys: ['svc_nails', 'svc_microchip', 'svc_certificate', 'svc_euthanasia', 'svc_cremation', 'svc_grooming', 'svc_hospitalization', 'svc_other', 'full_price_list'] },
    { title: 'Políticas', keys: ['species', 'pol_emergencies', 'pol_dont_do', 'pol_payment', 'pol_late', 'pol_deposit', 'pol_noshow', 'pol_invoicing', 'pol_discounts', 'pol_transfer_data'] },
    { title: 'El agente en WhatsApp', keys: ['wa_number', 'wa_is_business', 'wa_has_meta', 'wa_volume', 'wa_who', 'agent_name', 'agent_treatment', 'agent_accent', 'agent_tone', 'agent_greeting', 'agent_donts', 'agent_faqs', 'agent_directions', 'agent_home_visits'] },
    { title: 'Recordatorios', keys: ['rem_24h', 'rem_2h', 'rem_medical', 'rem_text'] },
    { title: 'Migración de datos', keys: ['mig_system', 'mig_exportable', 'mig_patients', 'mig_appts'] },
    { title: 'Fidelización', keys: ['loyalty_interest', 'loyalty_current'] },
    { title: 'Notas y metadata', keys: ['anything_else', 'source', 'submitted_at', 'user_agent', 'file_count'] },
]

const fmtVal = (v: any): string => {
    if (v === true) return 'Sí'
    if (v === false || v === '' || v == null) return '—'
    return String(v)
}

export default function AdminOnboarding() {
    const [rows, setRows] = useState<OnboardingRow[]>([])
    const [loading, setLoading] = useState(true)
    const [expanded, setExpanded] = useState<string | null>(null)
    const [files, setFiles] = useState<Record<string, StoredFile[]>>({})

    const fetchRows = useCallback(async () => {
        setLoading(true)
        try {
            const { data, error } = await (supabase as any).rpc('get_clinic_onboarding_submissions')
            if (error) throw error
            setRows(data || [])
        } catch (err: any) {
            console.error('Error fetching onboarding submissions:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchRows() }, [fetchRows])

    const loadFiles = useCallback(async (id: string) => {
        if (files[id]) return
        try {
            const { data: list, error } = await supabase.storage.from('clinic-onboarding').list(id, { limit: 100 })
            if (error) throw error
            const items = (list || []).filter((f) => f.name && f.id)
            const signed = await Promise.all(items.map(async (f) => {
                const { data } = await supabase.storage.from('clinic-onboarding').createSignedUrl(`${id}/${f.name}`, 3600)
                return { name: f.name, url: data?.signedUrl || '' }
            }))
            setFiles((prev) => ({ ...prev, [id]: signed.filter((s) => s.url) }))
        } catch (err) {
            console.error('Error listing onboarding files:', err)
            setFiles((prev) => ({ ...prev, [id]: [] }))
        }
    }, [files])

    const toggle = (id: string) => {
        const next = expanded === id ? null : id
        setExpanded(next)
        if (next) loadFiles(next)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <ClipboardList className="w-6 h-6 text-primary-500" />
                        Altas de clínica
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">Respuestas del formulario <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">vetly.pro/alta-clinica</code> — todo lo que la clínica declaró para configurar su agente.</p>
                </div>
                <button
                    onClick={fetchRows}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
                >
                    <RefreshCw className="w-4 h-4" />
                    Actualizar
                </button>
            </div>

            {rows.length === 0 ? (
                <p className="text-sm text-gray-500 py-10 text-center bg-white rounded-2xl border border-gray-200">Todavía no hay altas registradas.</p>
            ) : (
                <div className="space-y-3">
                    {rows.map((r) => {
                        const isOpen = expanded === r.id
                        return (
                            <div key={r.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                                <button
                                    onClick={() => toggle(r.id)}
                                    className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                                >
                                    <div className="min-w-0">
                                        <p className="font-semibold text-gray-900 truncate">{r.clinic_name || 'Sin nombre'}</p>
                                        <p className="text-xs text-gray-500 mt-0.5">
                                            {[r.city, r.country].filter(Boolean).join(', ') || '—'}
                                            {r.contact_email ? ` · ${r.contact_email}` : ''}
                                            {' · '}{new Date(r.created_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        {Number(r.submission?.file_count) > 0 && (
                                            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                                                <Paperclip className="w-3.5 h-3.5" />{r.submission.file_count}
                                            </span>
                                        )}
                                        {r.submission?.source && r.submission.source !== 'alta-clinica' && (
                                            <span className="text-xs font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">{r.submission.source}</span>
                                        )}
                                        {isOpen ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                                    </div>
                                </button>

                                {isOpen && (
                                    <div className="border-t border-gray-100 px-5 py-5 space-y-6">
                                        {(files[r.id]?.length ?? 0) > 0 && (
                                            <div>
                                                <h3 className="text-xs font-bold uppercase text-gray-400 mb-2">Archivos adjuntos</h3>
                                                <ul className="space-y-1.5">
                                                    {files[r.id].map((f) => (
                                                        <li key={f.name}>
                                                            <a href={f.url} target="_blank" rel="noreferrer"
                                                                className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium">
                                                                <FileDown className="w-4 h-4" />
                                                                {f.name.replace(/^\d+-/, '')}
                                                            </a>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {SECTIONS.map((sec) => {
                                            const present = sec.keys.filter((k) => k in (r.submission || {}))
                                            if (present.length === 0) return null
                                            return (
                                                <div key={sec.title}>
                                                    <h3 className="text-xs font-bold uppercase text-gray-400 mb-2">{sec.title}</h3>
                                                    <dl className="space-y-2.5">
                                                        {present.map((k) => (
                                                            <div key={k} className="grid sm:grid-cols-[220px_1fr] gap-1 sm:gap-4">
                                                                <dt className="text-xs font-semibold text-gray-500 pt-0.5">
                                                                    {LABELS[k] || k.replace(/_/g, ' ')}
                                                                </dt>
                                                                <dd className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                                                                    {fmtVal(r.submission[k])}
                                                                </dd>
                                                            </div>
                                                        ))}
                                                    </dl>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
