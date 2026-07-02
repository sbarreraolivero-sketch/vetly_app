
import { supabase } from '@/lib/supabase'

export interface CashRegister {
    id: string
    clinic_id: string
    date: string
    status: 'open' | 'closed'
    opening_balance: number
    total_cobrado: number
    total_pendiente: number
    total_efectivo: number
    total_transferencia: number
    total_tarjeta: number
    total_debito: number
    total_gastos: number
    income_count: number
    notes: string | null
    closed_by: string | null
    closed_at: string | null
    reopened_by: string | null
    reopened_at: string | null
    created_at: string
}

export interface Expense {
    id: string
    clinic_id: string
    description: string
    amount: number
    category: 'rent' | 'supplies' | 'payroll' | 'marketing' | 'utilities' | 'other'
    date: string
    payment_method?: string | null
    receipt_url?: string | null
    created_at: string
}

export interface Income {
    id: string
    clinic_id: string
    description: string
    amount: number
    discount?: number
    category: 'service' | 'product' | 'adjustment' | 'other'
    date: string
    tutor_id?: string | null
    services?: any[] | null
    notes?: string | null
    payment_method?: string | null
    created_at: string
}

export interface FinanceStats {
    total_income: number
    total_expenses: number
    net_profit: number
    appointments_count: number
}

export const financeService = {
    // Get Finance Stats via RPC
    async getStats(clinicId: string, startDate: Date, endDate: Date) {
        const { data, error } = await (supabase as any).rpc('get_finance_stats', {
            p_clinic_id: clinicId,
            p_start_date: startDate.toISOString(),
            p_end_date: endDate.toISOString()
        })

        if (error) throw error
        // RPC returns an array of one object
        return data?.[0] as FinanceStats
    },

    // Expenses CRUD
    async getExpenses(clinicId: string, startDate: Date, endDate: Date) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_clinic_expenses_secure', {
            p_clinic_id: clinicId,
            p_start_date: startDate.toISOString(),
            p_end_date: endDate.toISOString()
        })

        if (error) throw error
        return data as Expense[]
    },

    async addExpense(expense: Omit<Expense, 'id' | 'created_at'>) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('create_clinic_expense', {
            p_clinic_id:      expense.clinic_id,
            p_description:    expense.description,
            p_amount:         expense.amount,
            p_category:       expense.category,
            p_date:           expense.date,
            p_payment_method: expense.payment_method || null,
            p_receipt_url:    expense.receipt_url || null,
        })

        if (error) throw error
        return data?.[0] as Expense
    },

    async uploadExpenseReceipt(clinicId: string, expenseId: string, file: File): Promise<string> {
        const ext = file.name.split('.').pop() ?? 'jpg'
        const path = `${clinicId}/${expenseId}.${ext}`
        const { error } = await (supabase as any).storage
            .from('expense-receipts')
            .upload(path, file, { upsert: true })
        if (error) throw error
        const { data } = (supabase as any).storage
            .from('expense-receipts')
            .getPublicUrl(path)
        return data.publicUrl as string
    },

    async getExpenseReceiptUrl(clinicId: string, fileName: string): Promise<string> {
        const { data } = await (supabase as any).storage
            .from('expense-receipts')
            .createSignedUrl(`${clinicId}/${fileName}`, 3600)
        return data?.signedUrl ?? ''
    },

    async updateExpense(id: string, updates: Partial<Expense>, clinicId?: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query = (supabase as any).from('expenses').update(updates).eq('id', id)
        if (clinicId) query = query.eq('clinic_id', clinicId)
        const { data, error } = await query.select().single()
        if (error) throw error
        return data as Expense
    },

    async deleteExpense(id: string, clinicId?: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query = (supabase as any).from('expenses').delete().eq('id', id)
        if (clinicId) query = query.eq('clinic_id', clinicId)
        const { error } = await query
        if (error) throw error
    },

    // Incomes CRUD (Manual Incomes)
    async getIncomes(clinicId: string, startDate: Date, endDate: Date) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_clinic_incomes_secure', {
            p_clinic_id: clinicId,
            p_start_date: startDate.toISOString(),
            p_end_date: endDate.toISOString()
        })

        if (error) throw error
        return data as Income[]
    },

    async addIncome(income: Omit<Income, 'id' | 'created_at'> & { notes?: string; discount_reason?: string; iva_amount?: number }) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('create_clinic_income', {
            p_clinic_id:       income.clinic_id,
            p_description:     income.description,
            p_amount:          income.amount,
            p_category:        income.category,
            p_date:            income.date,
            p_tutor_id:        income.tutor_id || null,
            p_services:        income.services || [],
            p_discount:        income.discount || 0,
            p_notes:           income.notes || null,
            p_payment_method:  income.payment_method || null,
            p_discount_reason: income.discount_reason || null,
            p_iva_amount:      income.iva_amount ?? null,
        })

        if (error) throw error
        return data?.[0] as Income
    },

    async updateIncome(id: string, income: Partial<Omit<Income, 'id' | 'clinic_id' | 'created_at'>> & { notes?: string; payment_method?: string; discount_reason?: string; iva_amount?: number }) {
        const { data, error } = await (supabase as any).rpc('update_clinic_income', {
            p_income_id:       id,
            p_description:     income.description,
            p_amount:          income.amount,
            p_category:        income.category,
            p_date:            income.date,
            p_tutor_id:        income.tutor_id || null,
            p_services:        income.services || [],
            p_discount:        income.discount || 0,
            p_notes:           (income as any).notes || null,
            p_payment_method:  (income as any).payment_method || null,
            p_discount_reason: (income as any).discount_reason || null,
            p_iva_amount:      (income as any).iva_amount ?? null,
        })
        if (error) throw error
        return data?.[0] as Income
    },

    async deleteIncome(id: string) {
        const { error } = await (supabase as any)
            .from('incomes')
            .delete()
            .eq('id', id)

        if (error) throw error
    },

    async saveTransactionItems(
        appointmentId: string,
        clinicId: string,
        items: Array<{ item_type: string; name: string; quantity: number; unit_price: number; subtotal: number; product_id?: string | null }>,
        price: number,
        discount: number,
        paymentMethod: string | null,
        discountReason?: string | null,
        ivaAmount?: number | null,
    ) {
        const { error } = await (supabase as any).rpc('save_transaction_items', {
            p_appointment_id:  appointmentId,
            p_clinic_id:       clinicId,
            p_items:           JSON.stringify(items),
            p_price:           price,
            p_discount:        discount,
            p_payment_method:  paymentMethod,
            p_discount_reason: discountReason || null,
            p_iva_amount:      ivaAmount ?? null,
        })
        if (error) throw error
    },

    // Transactions (Completed Appointments)
    async getTransactions(clinicId: string, startDate?: Date, endDate?: Date) {
        // Default to last 30 days if no range provided, or handle in component?
        // Let's require them or default them to something reasonable to avoid breaking existing calls if any
        // But for now, we'll assume they will be passed.

        const start = startDate ? startDate.toISOString() : new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString()
        const end = endDate ? endDate.toISOString() : new Date().toISOString()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_clinic_transactions_secure', {
            p_clinic_id: clinicId,
            p_start_date: start,
            p_end_date: end
        })

        if (error) throw error
        return data
    },

    async updateTransactionPrice(appointmentId: string, price: number) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('appointments')
            .update({ price })
            .eq('id', appointmentId)
            .select()

        if (error) throw error
        return data?.[0]
    },

    // ── Appointment items ──────────────────────────────────────────────
    async getTransactionItems(appointmentId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .rpc('get_appointment_items', { p_appointment_id: appointmentId })
        if (error) throw error
        return (data ?? []) as Array<{
            id: string; item_type: string; name: string
            quantity: number; unit_price: number; subtotal: number; product_id: string | null
        }>
    },

    // ── Métricas avanzadas con appointment_items ───────────────────────
    async getItemMetrics(clinicId: string, startDate: Date, endDate: Date) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .rpc('get_finance_item_metrics', {
                p_clinic_id: clinicId,
                p_start: startDate.toISOString(),
                p_end: endDate.toISOString(),
            })
        if (error) throw error
        return data as {
            by_type: Array<{ item_type: string; item_count: number; total_revenue: number; total_units: number }> | null
            top_services: Array<{ name: string; revenue: number; units: number }> | null
            top_products: Array<{ name: string; revenue: number; units: number }> | null
            appt_metrics: { total_appts: number; appts_with_products: number; avg_ticket: number } | null
        } | null
    },

    // ---- Cajas Registradoras ----

    async getCashRegisters(clinicId: string, startDate: Date, endDate: Date) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('cash_registers')
            .select('*')
            .eq('clinic_id', clinicId)
            .gte('date', startDate.toISOString().split('T')[0])
            .lte('date', endDate.toISOString().split('T')[0])
            .order('date', { ascending: false })
        if (error) throw error
        return (data ?? []) as CashRegister[]
    },

    async updateOpeningBalance(clinicId: string, date: string, amount: number, userId: string) {
        const { error } = await (supabase as any).rpc('update_caja_opening_balance', {
            p_clinic_id: clinicId,
            p_date:      date,
            p_amount:    amount,
            p_user_id:   userId,
        })
        if (error) throw error
    },

    async openCashRegister(clinicId: string, date: string) {
        const { error } = await (supabase as any).rpc('open_cash_register', {
            p_clinic_id: clinicId,
            p_date:      date,
        })
        if (error) throw error
    },

    async closeCaja(clinicId: string, date: string, notes: string, closedBy: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('close_cash_register', {
            p_clinic_id: clinicId,
            p_date: date,
            p_notes: notes || null,
            p_closed_by: closedBy,
        })
        if (error) throw error
        return data as CashRegister
    },

    // Solo owners pueden reabrir una caja cerrada (verificado en el RPC)
    async reopenCaja(clinicId: string, date: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('reopen_cash_register', {
            p_clinic_id: clinicId,
            p_date: date,
        })
        if (error) throw error
        return data as CashRegister
    },
}
