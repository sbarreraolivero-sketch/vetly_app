export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            clinic_settings: {
                Row: {
                    id: string
                    clinic_name: string
                    services: Json
                    working_hours: Json
                    timezone: string
                    ycloud_api_key: string | null
                    ycloud_phone_number: string | null
                    openai_api_key: string | null
                    openai_model: string | null
                    ai_personality: string | null
                    ai_welcome_message: string | null
                    ai_auto_respond: boolean
                    reminders_enabled: boolean
                    reminders_time: string | null
                    reminders_hours_before: number
                    created_at: string
                    updated_at: string
                    activation_status: 'pending_activation' | 'active' | 'inactive'
                    trial_status: 'not_started' | 'running' | 'converted' | 'cancelled'
                    billing_status: 'none' | 'card_verified' | 'active_subscription' | 'payment_failed'
                    trial_start_date: string | null
                    trial_end_date: string | null
                    mercadopago_customer_id: string | null
                    mercadopago_card_id: string | null
                    instagram_url: string | null
                    facebook_url: string | null
                    tiktok_url: string | null
                    website_url: string | null
                    ai_credits_monthly_limit: number
                    ai_credits_extra_balance: number
                    ai_credits_extra_4o: number
                    ai_active_model: 'mini' | '4o'
                    subscription_plan: 'essence' | 'radiance' | 'prestige' | 'trial'
                    address_references: string | null
                    google_maps_url: string | null
                    business_model: 'physical' | 'mobile' | 'hybrid' | null
                    clinic_address: string | null
                    address: string | null
                    currency: string | null
                    template_survey: string | null
                    template_reactivation: string | null
                    vaccine_reminder_template: string | null
                    deworming_reminder_template: string | null
                }
                Insert: {
                    id?: string
                    clinic_name: string
                    services?: Json
                    working_hours?: Json
                    timezone?: string
                    ycloud_api_key?: string | null
                    ycloud_phone_number?: string | null
                    openai_api_key?: string | null
                    openai_model?: string | null
                    ai_personality?: string | null
                    ai_welcome_message?: string | null
                    ai_auto_respond?: boolean
                    reminders_enabled?: boolean
                    reminders_time?: string | null
                    reminders_hours_before?: number
                    created_at?: string
                    updated_at?: string
                    activation_status?: 'pending_activation' | 'active' | 'inactive'
                    trial_status?: 'not_started' | 'running' | 'converted' | 'cancelled'
                    billing_status?: 'none' | 'card_verified' | 'active_subscription' | 'payment_failed'
                    trial_start_date?: string | null
                    trial_end_date?: string | null
                    mercadopago_customer_id?: string | null
                    mercadopago_card_id?: string | null
                    instagram_url?: string | null
                    facebook_url?: string | null
                    tiktok_url?: string | null
                    website_url?: string | null
                    ai_credits_monthly_limit?: number
                    ai_credits_extra_balance?: number
                    ai_credits_extra_4o?: number
                    ai_active_model?: 'mini' | '4o'
                    subscription_plan?: 'essence' | 'radiance' | 'prestige' | 'trial'
                    address_references?: string | null
                    google_maps_url?: string | null
                    business_model?: 'physical' | 'mobile' | 'hybrid' | null
                    clinic_address?: string | null
                    address?: string | null
                    currency?: string | null
                    template_survey?: string | null
                    template_reactivation?: string | null
                }
                Update: {
                    id?: string
                    clinic_name?: string
                    services?: Json
                    working_hours?: Json
                    timezone?: string
                    ycloud_api_key?: string | null
                    ycloud_phone_number?: string | null
                    openai_api_key?: string | null
                    openai_model?: string | null
                    ai_personality?: string | null
                    ai_welcome_message?: string | null
                    ai_auto_respond?: boolean
                    reminders_enabled?: boolean
                    reminders_time?: string | null
                    reminders_hours_before?: number
                    created_at?: string
                    updated_at?: string
                    activation_status?: 'pending_activation' | 'active' | 'inactive'
                    trial_status?: 'not_started' | 'running' | 'converted' | 'cancelled'
                    billing_status?: 'none' | 'card_verified' | 'active_subscription' | 'payment_failed'
                    trial_start_date?: string | null
                    trial_end_date?: string | null
                    mercadopago_customer_id?: string | null
                    mercadopago_card_id?: string | null
                    instagram_url?: string | null
                    facebook_url?: string | null
                    tiktok_url?: string | null
                    website_url?: string | null
                    ai_credits_monthly_limit?: number
                    ai_credits_extra_balance?: number
                    ai_credits_extra_4o?: number
                    ai_active_model?: 'mini' | '4o'
                    subscription_plan?: 'essence' | 'radiance' | 'prestige' | 'trial'
                    address_references?: string | null
                    google_maps_url?: string | null
                    business_model?: 'physical' | 'mobile' | 'hybrid' | null
                    clinic_address?: string | null
                    address?: string | null
                    currency?: string | null
                    template_survey?: string | null
                    template_reactivation?: string | null
                }
            }
            subscriptions: {
                Row: {
                    id: string
                    clinic_id: string | null
                    plan_id: string | null
                    plan: 'essence' | 'radiance' | 'prestige' | 'trial'
                    status: 'active' | 'cancelled' | 'past_due' | 'trial'
                    mercadopago_subscription_id: string | null
                    current_period_start: string | null
                    current_period_end: string | null
                    trial_ends_at: string | null
                    monthly_appointments_limit: number | null
                    monthly_appointments_used: number
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    clinic_id?: string | null
                    plan_id?: string | null
                    plan: 'essence' | 'radiance' | 'prestige' | 'trial'
                    status?: 'active' | 'cancelled' | 'past_due' | 'trial'
                    mercadopago_subscription_id?: string | null
                    current_period_start?: string | null
                    current_period_end?: string | null
                    trial_ends_at?: string | null
                    monthly_appointments_limit?: number | null
                    monthly_appointments_used?: number
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    clinic_id?: string | null
                    plan_id?: string | null
                    plan?: 'essence' | 'radiance' | 'prestige' | 'trial'
                    status?: 'active' | 'cancelled' | 'past_due' | 'trial'
                    mercadopago_subscription_id?: string | null
                    current_period_start?: string | null
                    current_period_end?: string | null
                    trial_ends_at?: string | null
                    monthly_appointments_limit?: number | null
                    monthly_appointments_used?: number
                    created_at?: string
                    updated_at?: string
                }
            }
            appointments: {
                Row: {
                    id: string
                    clinic_id: string | null
                    patient_name: string
                    phone: string
                    service: string | null
                    appointment_date: string
                    duration: number
                    status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
                    notes: string | null
                    reminder_sent: boolean
                    reminder_sent_at: string | null
                    confirmation_received: boolean
                    confirmation_response: string | null
                    created_at: string
                    updated_at: string
                    tutor_id: string | null
                    pet_id: string | null
                    address: string | null
                    address_references: string | null
                    tutor_name: string | null
                    price: number
                    latitude: number | null
                    longitude: number | null
                    duration_minutes: number
                }
                Insert: {
                    id?: string
                    clinic_id?: string | null
                    patient_name: string
                    phone: string
                    service?: string | null
                    appointment_date: string
                    duration?: number
                    status?: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
                    notes?: string | null
                    reminder_sent?: boolean
                    reminder_sent_at?: string | null
                    confirmation_received?: boolean
                    confirmation_response?: string | null
                    created_at?: string
                    updated_at?: string
                    tutor_id?: string | null
                    pet_id?: string | null
                    address?: string | null
                    address_references?: string | null
                    tutor_name?: string | null
                    price?: number
                    latitude?: number | null
                    longitude?: number | null
                }
                Update: {
                    id?: string
                    clinic_id?: string | null
                    patient_name?: string
                    phone?: string
                    service?: string | null
                    appointment_date?: string
                    duration?: number
                    status?: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
                    notes?: string | null
                    reminder_sent?: boolean
                    reminder_sent_at?: string | null
                    confirmation_received?: boolean
                    confirmation_response?: string | null
                    created_at?: string
                    updated_at?: string
                    tutor_id?: string | null
                    pet_id?: string | null
                    address?: string | null
                    address_references?: string | null
                    tutor_name?: string | null
                    price?: number
                    latitude?: number | null
                    longitude?: number | null
                }
            }
            tutors: {
                Row: {
                    id: string
                    clinic_id: string | null
                    phone: string
                    name: string | null
                    email: string | null
                    address: string | null
                    notes: string | null
                    total_appointments: number
                    last_appointment_at: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    clinic_id?: string | null
                    phone: string
                    name?: string | null
                    email?: string | null
                    address?: string | null
                    notes?: string | null
                    total_appointments?: number
                    last_appointment_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    clinic_id?: string | null
                    phone?: string
                    name?: string | null
                    email?: string | null
                    address?: string | null
                    notes?: string | null
                    total_appointments?: number
                    last_appointment_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            patients: {
                Row: {
                    id: string
                    clinic_id: string | null
                    tutor_id: string | null
                    name: string
                    species: string | null
                    breed: string | null
                    color: string | null
                    sex: 'M' | 'F' | 'MN' | 'FN' | null
                    weight: number | null
                    weight_unit: string
                    dob: string | null
                    is_sterilized: boolean
                    microchip_id: string | null
                    status: 'alive' | 'deceased'
                    death_date: string | null
                    death_reason: string | null
                    notes: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    clinic_id?: string | null
                    tutor_id?: string | null
                    name: string
                    species?: string | null
                    breed?: string | null
                    color?: string | null
                    sex?: 'M' | 'F' | 'MN' | 'FN' | null
                    weight?: number | null
                    weight_unit?: string
                    dob?: string | null
                    is_sterilized?: boolean
                    microchip_id?: string | null
                    status?: 'alive' | 'deceased'
                    death_date?: string | null
                    death_reason?: string | null
                    notes?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    clinic_id?: string | null
                    tutor_id?: string | null
                    name?: string
                    species?: string | null
                    breed?: string | null
                    color?: string | null
                    sex?: 'M' | 'F' | 'MN' | 'FN' | null
                    weight?: number | null
                    weight_unit?: string
                    dob?: string | null
                    is_sterilized?: boolean
                    microchip_id?: string | null
                    status?: 'alive' | 'deceased'
                    death_date?: string | null
                    death_reason?: string | null
                    notes?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            reminder_settings: {
                Row: {
                    id: string
                    clinic_id: string
                    reminder_24h_before: boolean
                    reminder_2h_before: boolean
                    reminder_1h_before: boolean
                    request_confirmation: boolean
                    confirmation_days_before: number
                    preferred_hour: string
                    template_24h: string | null
                    template_2h: string | null
                    template_1h: string | null
                    template_confirmation: string | null
                    template_followup: string | null
                    followup_enabled: boolean
                    followup_days_after: number
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    clinic_id: string
                    reminder_24h_before?: boolean
                    reminder_2h_before?: boolean
                    reminder_1h_before?: boolean
                    request_confirmation?: boolean
                    confirmation_days_before?: number
                    preferred_hour?: string
                    template_24h?: string | null
                    template_2h?: string | null
                    template_1h?: string | null
                    template_confirmation?: string | null
                    template_followup?: string | null
                    followup_enabled?: boolean
                    followup_days_after?: number
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    clinic_id?: string
                    reminder_24h_before?: boolean
                    reminder_2h_before?: boolean
                    reminder_1h_before?: boolean
                    request_confirmation?: boolean
                    confirmation_days_before?: number
                    preferred_hour?: string
                    template_24h?: string | null
                    template_2h?: string | null
                    template_1h?: string | null
                    template_confirmation?: string | null
                    template_followup?: string | null
                    followup_enabled?: boolean
                    followup_days_after?: number
                    created_at?: string
                    updated_at?: string
                }
            }
            clinical_records: {
                Row: {
                    id: string
                    patient_id: string
                    general_notes: string | null
                    chronic_conditions: string | null
                    allergies: string | null
                    ongoing_treatments: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    patient_id: string
                    general_notes?: string | null
                    chronic_conditions?: string | null
                    allergies?: string | null
                    ongoing_treatments?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    patient_id?: string
                    general_notes?: string | null
                    chronic_conditions?: string | null
                    allergies?: string | null
                    ongoing_treatments?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            medical_history: {
                Row: {
                    id: string
                    patient_id: string
                    event_date: string
                    event_type: string | null
                    diagnosis: string | null
                    procedure_notes: string | null
                    veterinarian_id: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    patient_id: string
                    event_date?: string
                    event_type?: string | null
                    diagnosis?: string | null
                    procedure_notes?: string | null
                    veterinarian_id?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    patient_id?: string
                    event_date?: string
                    event_type?: string | null
                    diagnosis?: string | null
                    procedure_notes?: string | null
                    veterinarian_id?: string | null
                    created_at?: string
                }
            }
            vaccinations: {
                Row: {
                    id: string
                    patient_id: string
                    vaccine_name: string
                    application_date: string
                    next_due_date: string | null
                    lot_number: string | null
                    veterinarian_name: string | null
                    notes: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    patient_id: string
                    vaccine_name: string
                    application_date?: string
                    next_due_date?: string | null
                    lot_number?: string | null
                    veterinarian_name?: string | null
                    notes?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    patient_id?: string
                    vaccine_name?: string
                    application_date?: string
                    next_due_date?: string | null
                    lot_number?: string | null
                    veterinarian_name?: string | null
                    notes?: string | null
                    created_at?: string
                }
            }
            dewormings: {
                Row: {
                    id: string
                    patient_id: string
                    product_name: string
                    application_date: string
                    frequency_days: number | null
                    next_due_date: string | null
                    notes: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    patient_id: string
                    product_name: string
                    application_date?: string
                    frequency_days?: number | null
                    next_due_date?: string | null
                    notes?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    patient_id?: string
                    product_name?: string
                    application_date?: string
                    frequency_days?: number | null
                    next_due_date?: string | null
                    notes?: string | null
                    created_at?: string
                }
            }
            tags: {
                Row: {
                    id: string
                    clinic_id: string | null
                    name: string
                    color: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    clinic_id?: string | null
                    name: string
                    color: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    clinic_id?: string | null
                    name?: string
                    color?: string
                    created_at?: string
                }
            }
            tutor_tags: {
                Row: {
                    tutor_id: string
                    tag_id: string
                }
                Insert: {
                    tutor_id: string
                    tag_id: string
                }
                Update: {
                    tutor_id?: string
                    tag_id?: string
                }
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            [_ in never]: never
        }
    }
}

// Derived types for easier use
export type ClinicSettings = Database['public']['Tables']['clinic_settings']['Row']
export type Appointment = Database['public']['Tables']['appointments']['Row']
export type Tutor = Database['public']['Tables']['tutors']['Row']
export type Patient = Database['public']['Tables']['patients']['Row']
export type MedicalHistory = Database['public']['Tables']['medical_history']['Row']
export type ClinicalRecord = Database['public']['Tables']['clinical_records']['Row']
export type Vaccination = Database['public']['Tables']['vaccinations']['Row']
export type Deworming = Database['public']['Tables']['dewormings']['Row']
export type Tag = Database['public']['Tables']['tags']['Row']

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'

// Service type
export interface Service {
    id: string
    name: string
    duration: number // in minutes
    price: number
}

// Working hours type
export interface WorkingHours {
    [day: string]: {
        open: string // "09:00"
        close: string // "18:00"
        breaks?: { start: string; end: string }[]
    } | null // null means closed
}

// Conversation type for UI
export interface Conversation {
    phone_number: string
    patient_name?: string
    last_message: string
    last_message_at: string
    unread_count?: number
}
