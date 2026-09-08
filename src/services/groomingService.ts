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
    // Busca un tutor por teléfono dentro de la clínica; si no existe, lo crea.
    // Devuelve el id. El tutor queda como registro real DESDE el agendamiento,
    // no al completar la cita — así la ficha de estética y el consentimiento se
    // pueden llenar antes de atender a la mascota.
    async findOrCreateTutor(clinicId: string, name: string, phone: string): Promise<string> {
        const digits = (phone || '').replace(/\D/g, '')
        if (digits.length < 7) throw new Error('El tutor necesita un teléfono válido')
        const { data: existing } = await (supabase as any)
            .from('tutors').select('id, name')
            .eq('clinic_id', clinicId).eq('phone_number', digits).maybeSingle()
        if (existing?.id) {
            // completa el nombre si estaba vacío / genérico
            if (name.trim() && (!existing.name || /^sin nombre$/i.test(existing.name))) {
                await (supabase as any).from('tutors').update({ name: name.trim() }).eq('id', existing.id)
            }
            return existing.id
        }
        const { data, error } = await (supabase as any).from('tutors')
            .insert({ clinic_id: clinicId, phone_number: digits, name: name.trim() || 'Sin nombre' })
            .select('id').single()
        if (error) throw error
        return data.id
    },

    // Busca una mascota viva de ese tutor por nombre (case-insensitive); si no
    // existe, la crea. Devuelve el id — necesario para la ficha de estética.
    async findOrCreatePatient(clinicId: string, tutorId: string, name: string, species?: string | null): Promise<string> {
        const nm = name.trim()
        if (!nm) throw new Error('Falta el nombre de la mascota')
        const { data: existing } = await (supabase as any)
            .from('patients').select('id')
            .eq('tutor_id', tutorId).eq('status', 'alive').ilike('name', nm).limit(1)
        if (existing && existing.length > 0) return existing[0].id
        const { data, error } = await (supabase as any).from('patients')
            .insert({ clinic_id: clinicId, tutor_id: tutorId, name: nm, species: species || null })
            .select('id').single()
        if (error) throw error
        return data.id
    },

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

    // Resuelve precio + duración de la regla de estética más específica que
    // coincida con la ficha de la mascota. Devuelve nulls si no hay regla.
    async resolveRule(serviceId: string, size?: string | null, coat?: string | null, weight?: number | null, breed?: string | null): Promise<{ price: number | null; duration_minutes: number | null }> {
        const { data, error } = await (supabase as any).rpc('grooming_rule_resolve', {
            p_service_id: serviceId,
            p_size: size || null,
            p_coat: coat || null,
            p_weight: weight ?? null,
            p_breed: breed || null,
        })
        if (error || !data) return { price: null, duration_minutes: null }
        return { price: data.price ?? null, duration_minutes: data.duration_minutes ?? null }
    },

    async priceLookup(serviceId: string, size?: string | null, coat?: string | null, weight?: number | null, breed?: string | null): Promise<number | null> {
        return (await this.resolveRule(serviceId, size, coat, weight, breed)).price
    },

    // Igual que resolveRule pero tomando la talla/pelaje/peso/raza de la ficha de
    // la mascota. Útil al agendar: da la duración real del bloque de calendario.
    async resolveServiceForPatient(serviceId: string, patientId: string): Promise<{ price: number | null; duration_minutes: number | null }> {
        const [prof, { data: pat }] = await Promise.all([
            this.getProfile(patientId),
            (supabase as any).from('patients').select('weight, breed').eq('id', patientId).maybeSingle(),
        ])
        return this.resolveRule(serviceId, prof?.size_category ?? null, prof?.coat_type ?? null, (pat as any)?.weight ?? null, (pat as any)?.breed ?? null)
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

        // Recordatorio "toca baño" — si hay próxima visita, tutor y la clínica
        // tiene plantilla configurada. cron-process-reminders PART 4 lo recoge.
        // No bloquea el guardado si falla.
        if (nextVisitDate && params.tutorId) {
            try {
                const { data: cs } = await (supabase as any)
                    .from('clinic_settings')
                    .select('grooming_reminder_template, grooming_reminder_lead_days')
                    .eq('id', params.clinicId).maybeSingle()
                if (cs?.grooming_reminder_template) {
                    const lead = cs.grooming_reminder_lead_days ?? 3
                    const nv = new Date(nextVisitDate + 'T12:00:00')
                    nv.setDate(nv.getDate() - lead)
                    const scheduled = nv.toISOString().slice(0, 10)
                    // Idempotencia: una sola cita de baño pendiente por mascota.
                    await (supabase as any).from('reminders')
                        .delete().eq('patient_id', params.patientId).eq('type', 'grooming').eq('status', 'pending')
                    await (supabase as any).from('reminders').insert({
                        clinic_id: params.clinicId,
                        patient_id: params.patientId,
                        tutor_id: params.tutorId,
                        // se inyecta como {{2}} en la plantilla del recordatorio de baño
                        // ("...del próximo baño de Fito") — minúscula para leer bien.
                        title: 'baño',
                        scheduled_date: scheduled,
                        type: 'grooming',
                        whatsapp_template: cs.grooming_reminder_template,
                        status: 'pending',
                    })
                }
            } catch (e) {
                console.error('[groomingService] no se pudo crear el recordatorio de baño', e)
            }
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
