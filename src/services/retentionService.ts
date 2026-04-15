
import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────

export interface RetentionDashboardStats {
    total_patients: number
    patients_low: number
    patients_medium: number
    patients_high: number
    revenue_at_risk: number
    revenue_recoverable: number
    revenue_recovered_month: number
    avg_score: number
    last_computed_at: string | null
}

export interface PatientAtRisk {
    patient_id: string
    patient_name: string
    phone_number: string
    score: number
    risk_level: 'low' | 'medium' | 'high'
    days_since_last_visit: number
    delay_days: number
    last_service: string | null
    last_visit_date: string | null
    avg_ticket: number
    total_visits: number
    cancellation_count: number
    is_vip: boolean
}

export interface AIAction {
    id: string
    clinic_id: string
    patient_id: string | null
    protocol_id: string | null
    action_type: string
    action_details: Record<string, unknown>
    trigger_score: number
    trigger_risk_level: string
    execution_mode: 'supervised' | 'autonomous'
    status: 'pending' | 'approved' | 'executed' | 'reverted' | 'rejected' | 'failed'
    result: string | null
    result_revenue: number
    created_at: string
    executed_at: string | null
    reverted_at: string | null
}

export interface ServiceReturnWindow {
    id: string
    clinic_id: string
    service_name: string
    return_window_days: number
}

export interface RetentionSettings {
    autonomous_mode: boolean
    medium_risk_template: string
    high_risk_template: string
}

export interface YCloudTemplate {
    id: string
    name: string
    language: string
    status: string
    category: string
    body: string
    desc?: string // Frontend mapping helper
}

// ── Service ──────────────────────────────────────────────────────────

export const retentionService = {
    // Get dashboard KPIs
    async getDashboardStats(clinicId: string): Promise<RetentionDashboardStats> {
        const { data, error } = await (supabase as any).rpc('get_retention_dashboard_stats', {
            p_clinic_id: clinicId
        })
        if (error) throw error
        return data?.[0] as RetentionDashboardStats
    },

    // Get patients at risk (paginated)
    async getPatientsAtRisk(
        clinicId: string,
        riskLevel?: 'low' | 'medium' | 'high' | null,
        limit = 50,
        offset = 0
    ): Promise<PatientAtRisk[]> {
        const { data, error } = await (supabase as any).rpc('get_patients_at_risk', {
            p_clinic_id: clinicId,
            p_risk_level: riskLevel || null,
            p_limit: limit,
            p_offset: offset
        })
        if (error) throw error
        return data as PatientAtRisk[]
    },

    // Compute scores on demand (for manual refresh)
    async computeScores(clinicId: string): Promise<number> {
        // 1. Compute scores
        const { data, error } = await (supabase as any).rpc('compute_clinic_retention_scores', {
            p_clinic_id: clinicId
        })
        if (error) throw error

        // 2. Generate actions (chained)
        try {
            await (supabase as any).rpc('generate_retention_actions', {
                p_clinic_id: clinicId
            })
        } catch (e) {
            console.warn('Error generating actions:', e)
        }

        return data as number
    },

    // Get AI action log
    async getActionLog(clinicId: string, limit = 20): Promise<AIAction[]> {
        const { data, error } = await (supabase as any)
            .from('ai_action_log')
            .select('*')
            .eq('clinic_id', clinicId)
            .order('created_at', { ascending: false })
            .limit(limit)
        if (error) throw error
        return data as AIAction[]
    },

    // Get pending actions (for approval queue)
    async getPendingActions(clinicId: string): Promise<AIAction[]> {
        const { data, error } = await (supabase as any)
            .from('ai_action_log')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
        if (error) throw error
        return data as AIAction[]
    },

    // Approve an AI action
    async approveAction(actionId: string): Promise<void> {
        const { error } = await (supabase as any)
            .from('ai_action_log')
            .update({ status: 'approved', executed_at: new Date().toISOString() })
            .eq('id', actionId)
        if (error) throw error
    },

    // Revert an AI action
    async revertAction(actionId: string): Promise<void> {
        const { error } = await (supabase as any)
            .from('ai_action_log')
            .update({ status: 'reverted', reverted_at: new Date().toISOString() })
            .eq('id', actionId)
        if (error) throw error
    },

    // Reject a pending action
    async rejectAction(actionId: string): Promise<void> {
        const { error } = await (supabase as any)
            .from('ai_action_log')
            .update({ status: 'rejected' })
            .eq('id', actionId)
        if (error) throw error
    },

    // Get service return windows
    async getReturnWindows(clinicId: string): Promise<ServiceReturnWindow[]> {
        const { data, error } = await (supabase as any)
            .from('service_return_windows')
            .select('*')
            .eq('clinic_id', clinicId)
            .order('service_name')
        if (error) throw error
        return data as ServiceReturnWindow[]
    },

    // Update a return window
    async updateReturnWindow(id: string, days: number): Promise<void> {
        const { error } = await (supabase as any)
            .from('service_return_windows')
            .update({ return_window_days: days })
            .eq('id', id)
        if (error) throw error
    },

    // Initialize default return windows
    async initializeDefaults(clinicId: string): Promise<void> {
        const { error } = await (supabase as any).rpc('initialize_default_return_windows', {
            p_clinic_id: clinicId
        })
        if (error) throw error
    },

    // Export patients at risk as CSV
    exportCSV(patients: PatientAtRisk[], clinicName: string): void {
        const BOM = '\uFEFF'
        const header = `Revenue Retention Engine - ${clinicName}\nGenerado: ${new Date().toLocaleString('es-CL')}\n\n`
        const csvHeader = 'Paciente,Teléfono,Score,Riesgo,Días sin visita,Retraso,Último servicio,Última visita,Ticket promedio,Visitas,Cancelaciones,VIP\n'
        const rows = patients.map(p =>
            `"${p.patient_name || 'Sin nombre'}","${p.phone_number}",${p.score},"${p.risk_level}",${p.days_since_last_visit},${p.delay_days},"${p.last_service || '-'}","${p.last_visit_date || '-'}",${p.avg_ticket},${p.total_visits},${p.cancellation_count},${p.is_vip ? 'Sí' : 'No'}`
        ).join('\n')

        const blob = new Blob([BOM + header + csvHeader + rows], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `retención_${clinicName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    },

    // Get protocol settings
    async getSettings(clinicId: string): Promise<RetentionSettings> {
        const { data, error } = await (supabase as any)
            .from('retention_protocols')
            .select('risk_level_trigger, execution_mode, actions')
            .eq('clinic_id', clinicId)

        if (error) throw error

        const medium = data?.find((p: any) => p.risk_level_trigger === 'medium')
        const high = data?.find((p: any) => p.risk_level_trigger === 'high')

        // Assume autonomous if ANY is autonomous
        const isAutonomous = medium?.execution_mode === 'autonomous' || high?.execution_mode === 'autonomous'

        return {
            autonomous_mode: isAutonomous,
            medium_risk_template: (medium?.actions as any)?.template_name || 'retention_warning_soft',
            high_risk_template: (high?.actions as any)?.template_name || 'retention_danger_offer'
        }
    },

    // Update settings via RPC
    async updateSettings(clinicId: string, settings: RetentionSettings): Promise<void> {
        const { error } = await (supabase as any).rpc('update_retention_config', {
            p_clinic_id: clinicId,
            p_autonomous_mode: settings.autonomous_mode,
            p_medium_template: settings.medium_risk_template,
            p_high_template: settings.high_risk_template
        })
        if (error) throw error
        if (error) throw error
    },

    // Get remote templates from YCloud
    async getRemoteTemplates(clinicId: string): Promise<YCloudTemplate[]> {
        const { data, error } = await supabase.functions.invoke('ycloud-templates', {
            method: 'POST',
            body: { action: 'list', clinic_id: clinicId }
        })
        if (error) throw error
        if (data?.isError || data?.error) {
            let errMsg = 'API Error'
            if (typeof data.error === 'string') errMsg = data.error
            else if (data.error?.message) errMsg = data.error.message
            else if (data.message) errMsg = data.message
            else errMsg = JSON.stringify(data.error || data)
            throw new Error(errMsg)
        }
        return data.templates || []
    },

    async createRemoteTemplate(clinicId: string, name: string, bodyText: string, buttons?: string[], examples?: string[]): Promise<any> {
        const { data, error } = await supabase.functions.invoke('ycloud-templates', {
            method: 'POST',
            body: { action: 'create', clinic_id: clinicId, name, body_text: bodyText, buttons, examples }
        })
        if (error) throw error
        if (data?.isError || data?.error) {
            let errMsg = 'API Error'
            if (typeof data.error === 'string') errMsg = data.error
            else if (data.error?.message) errMsg = data.error.message
            else if (data.message) errMsg = data.message
            else errMsg = JSON.stringify(data.error || data)
            throw new Error(errMsg)
        }
        return data
    },

    // Delete a template from YCloud
    async deleteRemoteTemplate(clinicId: string, name: string): Promise<any> {
        const { data, error } = await supabase.functions.invoke('ycloud-templates', {
            method: 'POST',
            body: { action: 'delete', clinic_id: clinicId, name }
        })
        if (error) throw error
        if (data?.isError || data?.error) {
            let errMsg = 'API Error'
            if (typeof data.error === 'string') errMsg = data.error
            else if (data.error?.message) errMsg = data.error.message
            else if (data.message) errMsg = data.message
            else errMsg = JSON.stringify(data.error || data)

            throw new Error(errMsg)
        }
        return data
    }
}
