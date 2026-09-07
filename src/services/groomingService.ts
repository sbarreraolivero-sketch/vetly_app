import { supabase } from '@/lib/supabase'
import { financeService } from './financeService'

export interface GroomingProfile {
    id?: string
    patient_id: string
    clinic_id: string
    coat_type: string | null
    coat_length: string | null
    size_category: string | null
    preferred_cut: string | null
    cut_reference_photo_url: string | null
    products_notes: string | null
    product_allergies: string | null
    temperament: string | null
    handling_notes: string | null
    matting_policy_ack: boolean
    medical_alerts: string | null
}

export interface GroomingSessionServiceLine { name: string; price: number; add_on?: boolean }

export interface GroomingSession {
    id: string
    clinic_id: string
    patient_id: string
    appointment_id: string | null
    groomer_member_id: string | null
    session_date: string
    services: GroomingSessionServiceLine[]
    findings: string | null
    before_photos: string[]
    after_photos: string[]
    products_used: string | null
    next_visit_weeks: number | null
    next_visit_date: string | null
    notes: string | null
    public_token: string
    income_id: string | null
    created_at: string
}

export const COAT_TYPES = ['corto', 'medio', 'largo', 'doble', 'rizado', 'sin_pelo'] as const
export const SIZE_CATEGORIES = ['xs', 's', 'm', 'l', 'xl'] as const
export const TEMPERAMENTS = ['tranquilo', 'nervioso', 'agresivo', 'requiere_bozal', 'requiere_2_personas'] as const

export const TEMPERAMENT_LABEL: Record<string, string> = {
    tranquilo: 'Tranquilo', nervioso: 'Nervioso', agresivo: 'Agresivo',
    requiere_bozal: 'Requiere bozal', requiere_2_personas: 'Requiere 2 personas',
}
export const SIZE_LABEL: Record<string, string> = { xs: 'XS · Toy', s: 'S · Pequeño', m: 'M · Mediano', l: 'L · Grande', xl: 'XL · Gigante' }

export const groomingService = {
    async getProfile(patientId: string): Promise<GroomingProfile | null> {
        const { data } = await (supabase as any)
            .from('grooming_profiles').select('*').eq('patient_id', patientId).maybeSingle()
        return data ?? null
    },

    async upsertProfile(p: GroomingProfile): Promise<void> {
        const { error } = await (supabase as any)
            .from('grooming_profiles')
            .upsert({
                patient_id: p.patient_id,
                clinic_id: p.clinic_id,
                coat_type: p.coat_type || null,
                coat_length: p.coat_length || null,
                size_category: p.size_category || null,
                preferred_cut: p.preferred_cut || null,
                cut_reference_photo_url: p.cut_reference_photo_url || null,
                products_notes: p.products_notes || null,
                product_allergies: p.product_allergies || null,
                temperament: p.temperament || null,
                handling_notes: p.handling_notes || null,
                matting_policy_ack: !!p.matting_policy_ack,
                medical_alerts: p.medical_alerts || null,
            }, { onConflict: 'patient_id' })
        if (error) throw error
    },

    // Borrador de sesión creado al recepcionar la mascota (ingreso). El cierre
    // reabre esta misma fila. NO marca la cita como completada.
    async startSession(params: {
        clinicId: string; patientId: string; appointmentId?: string | null
        groomerMemberId?: string | null; intakeNotes?: string | null; createdBy?: string | null
    }): Promise<string> {
        // Si ya hay una sesión sin cerrar para esta cita, la reutiliza.
        if (params.appointmentId) {
            const { data: existing } = await (supabase as any)
                .from('grooming_sessions').select('id').eq('appointment_id', params.appointmentId).maybeSingle()
            if (existing?.id) {
                if (params.intakeNotes) {
                    await (supabase as any).from('grooming_sessions')
                        .update({ findings: params.intakeNotes }).eq('id', existing.id)
                }
                return existing.id
            }
        }
        const { data, error } = await (supabase as any).from('grooming_sessions').insert({
            clinic_id: params.clinicId,
            patient_id: params.patientId,
            appointment_id: params.appointmentId ?? null,
            groomer_member_id: params.groomerMemberId ?? null,
            findings: params.intakeNotes || null,
            created_by: params.createdBy ?? null,
        }).select('id').single()
        if (error) throw error
        return data.id
    },

    async getSessionForAppointment(appointmentId: string): Promise<GroomingSession | null> {
        const { data } = await (supabase as any)
            .from('grooming_sessions').select('*').eq('appointment_id', appointmentId).maybeSingle()
        return data ?? null
    },

    async getSessions(patientId: string): Promise<GroomingSession[]> {
        const { data, error } = await (supabase as any)
            .from('grooming_sessions').select('*')
            .eq('patient_id', patientId).order('session_date', { ascending: false })
        if (error) throw error
        return (data as any) || []
    },

    async getGroomingServices(clinicId: string) {
        const { data } = await (supabase as any)
            .from('clinic_services')
            .select('id, name, duration, price')
            .eq('clinic_id', clinicId).eq('category', 'grooming')
            .order('name', { ascending: true })
        return (data as any[]) || []
    },

    async priceLookup(serviceId: string, size?: string | null, coat?: string | null, weight?: number | null, breed?: string | null): Promise<number | null> {
        const { data, error } = await (supabase as any).rpc('grooming_price_lookup', {
            p_service_id: serviceId,
            p_size: size || null,
            p_coat: coat || null,
            p_weight: weight ?? null,
            p_breed: breed || null,
        })
        if (error) return null
        return data ?? null
    },

    // Sube varias fotos a patient-documents/{clinic}/{patient}/grooming/{sessionId}/...
    async uploadPhotos(clinicId: string, patientId: string, sessionId: string, kind: 'before' | 'after', files: File[]): Promise<string[]> {
        const urls: string[] = []
        for (const file of files) {
            const ext = file.name.split('.').pop() || 'jpg'
            const path = `${clinicId}/${patientId}/grooming/${sessionId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
            const { error } = await supabase.storage.from('patient-documents').upload(path, file)
            if (error) throw error
            const { data } = supabase.storage.from('patient-documents').getPublicUrl(path)
            urls.push(data.publicUrl)
        }
        return urls
    },

    // Cierre de sesión: crea/actualiza la grooming_session + (opcional) el cobro
    // vía financeService.addIncome (dispara sync_income_loyalty). El appointment,
    // si lo hay, se marca completed.
    async saveSession(params: {
        sessionId?: string | null
        clinicId: string
        patientId: string
        patientName: string
        appointmentId?: string | null
        groomerMemberId?: string | null
        tutorId?: string | null
        services: GroomingSessionServiceLine[]
        findings?: string | null
        beforePhotos: string[]
        afterPhotos: string[]
        productsUsed?: string | null
        nextVisitWeeks?: number | null
        notes?: string | null
        charge?: { total: number; discount?: number; paymentMethod?: string } | null
        currency?: string
        createdBy?: string | null
    }): Promise<string> {
        const nextVisitDate = params.nextVisitWeeks && params.nextVisitWeeks > 0
            ? new Date(Date.now() + params.nextVisitWeeks * 7 * 86400000).toISOString().slice(0, 10)
            : null

        const row: Record<string, unknown> = {
            clinic_id: params.clinicId,
            patient_id: params.patientId,
            appointment_id: params.appointmentId ?? null,
            groomer_member_id: params.groomerMemberId ?? null,
            services: params.services,
            findings: params.findings || null,
            before_photos: params.beforePhotos,
            after_photos: params.afterPhotos,
            products_used: params.productsUsed || null,
            next_visit_weeks: params.nextVisitWeeks ?? null,
            next_visit_date: nextVisitDate,
            notes: params.notes || null,
            created_by: params.createdBy ?? null,
        }

        let sessionId = params.sessionId
        if (sessionId) {
            const { error } = await (supabase as any).from('grooming_sessions').update(row).eq('id', sessionId)
            if (error) throw error
        } else {
            const { data, error } = await (supabase as any).from('grooming_sessions').insert(row).select('id').single()
            if (error) throw error
            sessionId = data.id
        }

        // Cobro (opcional) → incomes vía RPC (loyalty automático).
        if (params.charge && params.charge.total > 0) {
            const desc = `Estética · ${params.patientName}` +
                (params.services.length ? ` — ${params.services.map(s => s.name).join(', ')}` : '')
            const income = await financeService.addIncome({
                clinic_id: params.clinicId,
                description: desc,
                amount: params.charge.total,
                category: 'service',
                date: new Date().toISOString().slice(0, 10),
                tutor_id: params.tutorId || null,
                services: params.services.map(s => ({ name: s.name, price: s.price, type: 'service' })),
                discount: params.charge.discount || 0,
                payment_method: params.charge.paymentMethod || null,
            } as any)
            if (income?.id) {
                await (supabase as any).from('grooming_sessions').update({ income_id: income.id }).eq('id', sessionId)
            }
        }

        // Marca la cita como completada.
        if (params.appointmentId) {
            await (supabase as any).from('appointments')
                .update({ status: 'completed' }).eq('id', params.appointmentId)
        }

        return sessionId as string
    },

    async deleteSession(id: string): Promise<void> {
        const { error } = await (supabase as any).from('grooming_sessions').delete().eq('id', id)
        if (error) throw error
    },

    async sendReport(sessionId: string, channel: 'whatsapp' | 'email') {
        const { data, error } = await supabase.functions.invoke('send-grooming-report', {
            body: { session_id: sessionId, channel },
        })
        if (error) throw error
        if (!(data as any)?.success) throw new Error((data as any)?.error || 'No se pudo enviar el reporte')
        return data
    },
}
