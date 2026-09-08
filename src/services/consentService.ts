import { supabase } from '@/lib/supabase'

export type ConsentState = 'valid' | 'missing' | 'expired' | 'outdated'

export interface ConsentStatus {
    state: ConsentState
    record?: {
        id: string
        public_token: string
        signed_at: string | null
        signer_name: string | null
        template_version_at: string | null
    }
    template?: { validity_days: number | null; updated_at: string }
}

const STATE_LABEL: Record<ConsentState, string> = {
    valid: 'Consentimiento firmado',
    missing: 'Falta el consentimiento',
    expired: 'El consentimiento venció — vuelve a solicitarlo',
    outdated: 'La plantilla del consentimiento cambió desde la última firma — vuelve a solicitarlo',
}

export const consentService = {
    stateLabel: (s: ConsentState) => STATE_LABEL[s],

    /**
     * Estado del consentimiento de un paciente para una plantilla dada.
     * - missing:  no hay ninguno firmado
     * - expired:  la plantilla tiene validity_days y signed_at + validity_days ya pasó
     * - outdated: el texto de la plantilla cambió (template.updated_at) después de firmar
     * - valid:    en cualquier otro caso
     */
    async getConsentStatus(clinicId: string, patientId: string, templateKey: string): Promise<ConsentStatus> {
        const [{ data: tpl }, { data: recs }] = await Promise.all([
            (supabase as any)
                .from('consent_templates')
                .select('validity_days, updated_at')
                .eq('clinic_id', clinicId)
                .eq('template_key', templateKey)
                .maybeSingle(),
            (supabase as any)
                .from('consent_records')
                .select('id, public_token, signed_at, signer_name, template_version_at')
                .eq('patient_id', patientId)
                .eq('template_key', templateKey)
                .eq('status', 'signed')
                .order('signed_at', { ascending: false })
                .limit(1),
        ])

        const template = tpl ? { validity_days: tpl.validity_days ?? null, updated_at: tpl.updated_at } : undefined
        const record = (recs && recs.length > 0) ? recs[0] : undefined

        if (!record) return { state: 'missing', template }

        // Vencimiento
        if (template?.validity_days && record.signed_at) {
            const signed = new Date(record.signed_at).getTime()
            const ageDays = (Date.now() - signed) / 86400000
            if (ageDays > template.validity_days) return { state: 'expired', record, template }
        }

        // Plantilla editada después de firmar (comparación con margen de 1s por precisión)
        if (template?.updated_at && record.template_version_at) {
            const tplAt = new Date(template.updated_at).getTime()
            const recAt = new Date(record.template_version_at).getTime()
            if (tplAt - recAt > 1000) return { state: 'outdated', record, template }
        }

        return { state: 'valid', record, template }
    },
}
