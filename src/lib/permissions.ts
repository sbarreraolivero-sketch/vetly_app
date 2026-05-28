
export type PageKey =
  | 'dashboard'
  | 'appointments'
  | 'patients'
  | 'tutors'
  | 'messages'
  | 'crm'
  | 'campaigns'
  | 'reminders'
  | 'knowledge_base'
  | 'finance'
  | 'ai_settings'
  | 'settings'
  | 'loyalty'
  | 'templates'
  | 'integrations'

export type ActionKey =
  | 'dashboard_metrics'
  | 'patients_create'
  | 'patients_edit'
  | 'patients_delete'
  | 'tutors_create'
  | 'tutors_edit'
  | 'tutors_delete'
  | 'appointments_create'
  | 'appointments_edit'
  | 'appointments_delete'
  | 'export_data'

export interface MemberPermissions {
  pages: Record<PageKey, boolean>
  actions: Record<ActionKey, boolean>
}

export type UserRole = 'owner' | 'admin' | 'professional' | 'receptionist' | 'vet_assistant'

const ALL_PAGES: Record<PageKey, boolean> = {
  dashboard: true,
  appointments: true,
  patients: true,
  tutors: true,
  messages: true,
  crm: true,
  campaigns: true,
  reminders: true,
  knowledge_base: true,
  finance: true,
  ai_settings: true,
  settings: true,
  loyalty: true,
  templates: true,
  integrations: true,
}

const ALL_ACTIONS: Record<ActionKey, boolean> = {
  dashboard_metrics: true,
  patients_create: true,
  patients_edit: true,
  patients_delete: true,
  tutors_create: true,
  tutors_edit: true,
  tutors_delete: true,
  appointments_create: true,
  appointments_edit: true,
  appointments_delete: true,
  export_data: true,
}

export const FULL_PERMISSIONS: MemberPermissions = {
  pages: ALL_PAGES,
  actions: ALL_ACTIONS,
}

export const ROLE_DEFAULTS: Record<UserRole, MemberPermissions> = {
  owner: FULL_PERMISSIONS,
  admin: FULL_PERMISSIONS,
  professional: {
    pages: {
      dashboard: true,
      appointments: true,
      patients: true,
      tutors: true,
      messages: true,
      crm: false,
      campaigns: false,
      reminders: true,
      knowledge_base: false,
      finance: false,
      ai_settings: false,
      settings: false,
      loyalty: false,
      templates: true,
      integrations: false,
    },
    actions: {
      dashboard_metrics: false,
      patients_create: true,
      patients_edit: true,
      patients_delete: false,
      tutors_create: true,
      tutors_edit: true,
      tutors_delete: false,
      appointments_create: true,
      appointments_edit: true,
      appointments_delete: false,
      export_data: false,
    },
  },
  receptionist: {
    pages: {
      dashboard: true,
      appointments: true,
      patients: true,
      tutors: true,
      messages: true,
      crm: true,
      campaigns: false,
      reminders: true,
      knowledge_base: false,
      finance: false,
      ai_settings: false,
      settings: false,
      loyalty: false,
      templates: true,
      integrations: false,
    },
    actions: {
      dashboard_metrics: false,
      patients_create: true,
      patients_edit: true,
      patients_delete: false,
      tutors_create: true,
      tutors_edit: true,
      tutors_delete: false,
      appointments_create: true,
      appointments_edit: true,
      appointments_delete: true,
      export_data: false,
    },
  },
  vet_assistant: {
    pages: {
      dashboard: true,
      appointments: true,
      patients: true,
      tutors: true,
      messages: false,
      crm: false,
      campaigns: false,
      reminders: true,
      knowledge_base: false,
      finance: false,
      ai_settings: false,
      settings: false,
      loyalty: false,
      templates: false,
      integrations: false,
    },
    actions: {
      dashboard_metrics: false,
      patients_create: false,
      patients_edit: false,
      patients_delete: false,
      tutors_create: false,
      tutors_edit: false,
      tutors_delete: false,
      appointments_create: true,
      appointments_edit: true,
      appointments_delete: false,
      export_data: false,
    },
  },
}

export function getEffectivePermissions(
  role: UserRole,
  storedPermissions?: MemberPermissions | null
): MemberPermissions {
  if (role === 'owner' || role === 'admin') return FULL_PERMISSIONS
  if (!storedPermissions) return ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.professional
  return storedPermissions
}
