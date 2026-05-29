import { supabase } from '@/lib/supabase'
import type { InventoryProduct, InventoryMovement, AppointmentItem } from '@/types/database'

export type { InventoryProduct, InventoryMovement, AppointmentItem }

export interface ProductWithMovement extends InventoryProduct {
    last_movement_at?: string | null
    days_since_movement?: number | null
}

export interface AbcProduct {
    product_id: string
    product_name: string
    category: string
    unit: string
    total_sold: number
    total_revenue: number
    revenue_pct: number
    abc_class: 'A' | 'B' | 'C'
}

export interface NoRotationProduct {
    product_id: string
    product_name: string
    category: string
    stock_quantity: number
    last_movement_at: string | null
    days_no_movement: number
}

export interface VisitItem {
    id: string             // temp client ID
    item_type: 'service' | 'product'
    name: string
    quantity: number
    unit_price: number
    subtotal: number
    product_id?: string | null
}

export const inventoryService = {

    // ── Productos ──────────────────────────────────────────────────────

    async getProducts(clinicId: string): Promise<InventoryProduct[]> {
        const { data, error } = await supabase
            .from('inventory_products')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('is_active', true)
            .order('name')
        if (error) throw error
        return data ?? []
    },

    async getAllProducts(clinicId: string): Promise<InventoryProduct[]> {
        const { data, error } = await supabase
            .from('inventory_products')
            .select('*')
            .eq('clinic_id', clinicId)
            .order('name')
        if (error) throw error
        return data ?? []
    },

    async createProduct(product: Omit<InventoryProduct, 'id' | 'created_at' | 'updated_at'>): Promise<InventoryProduct> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_products')
            .insert(product)
            .select()
            .single()
        if (error) throw error
        return data
    },

    async updateProduct(id: string, updates: Partial<InventoryProduct>): Promise<InventoryProduct> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_products')
            .update(updates)
            .eq('id', id)
            .select()
            .single()
        if (error) throw error
        return data
    },

    async archiveProduct(id: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
            .from('inventory_products')
            .update({ is_active: false })
            .eq('id', id)
        if (error) throw error
    },

    // ── Movimientos ────────────────────────────────────────────────────

    async getMovements(
        clinicId: string,
        filters?: { productId?: string; type?: string; startDate?: string; endDate?: string }
    ): Promise<(InventoryMovement & { product_name?: string })[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (supabase as any)
            .from('inventory_movements')
            .select('*, inventory_products(name)')
            .eq('clinic_id', clinicId)
            .order('created_at', { ascending: false })
            .limit(200)

        if (filters?.productId) q = q.eq('product_id', filters.productId)
        if (filters?.type)      q = q.eq('type', filters.type)
        if (filters?.startDate) q = q.gte('created_at', filters.startDate)
        if (filters?.endDate)   q = q.lte('created_at', filters.endDate)

        const { data, error } = await q
        if (error) throw error
        return (data ?? []).map((m: any) => ({
            ...m,
            product_name: m.inventory_products?.name,
        }))
    },

    async addMovement(movement: Omit<InventoryMovement, 'id' | 'created_at'>): Promise<InventoryMovement> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_movements')
            .insert(movement)
            .select()
            .single()
        if (error) throw error
        return data
    },

    // ── Cierre de visita ───────────────────────────────────────────────

    async closeVisit(params: {
        appointmentId: string
        clinicId: string
        items: VisitItem[]
        discount?: number
        finalTotal?: number
        paymentMethod: string
        paymentStatus: 'paid' | 'pending'
        tutorId?: string | null
    }): Promise<void> {
        const subtotal = params.items.reduce((sum, i) => sum + i.subtotal, 0)
        const discount = params.discount ?? 0
        const totalPrice = params.finalTotal ?? Math.max(0, subtotal - discount)

        // 1. Actualizar appointment
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: apptErr } = await (supabase as any)
            .from('appointments')
            .update({
                status: 'completed',
                price: totalPrice,
                discount,
                payment_method: params.paymentMethod,
                payment_status: params.paymentStatus,
            })
            .eq('id', params.appointmentId)
        if (apptErr) throw apptErr

        // 2. Insertar appointment_items
        if (params.items.length > 0) {
            const rows = params.items.map(item => ({
                appointment_id: params.appointmentId,
                clinic_id: params.clinicId,
                item_type: item.item_type,
                name: item.name,
                quantity: item.quantity,
                unit_price: item.unit_price,
                subtotal: item.subtotal,
                product_id: item.product_id ?? null,
            }))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: itemErr } = await (supabase as any)
                .from('appointment_items')
                .insert(rows)
            if (itemErr) throw itemErr
        }

        // 3. Inventory movements para productos vendidos
        const productItems = params.items.filter(i => i.item_type === 'product' && i.product_id)
        if (productItems.length > 0) {
            const movements = productItems.map(item => ({
                clinic_id: params.clinicId,
                product_id: item.product_id!,
                type: 'sale' as const,
                quantity: -item.quantity,
                unit_price: item.unit_price,
                appointment_id: params.appointmentId,
                tutor_id: params.tutorId ?? null,
            }))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: mvErr } = await (supabase as any)
                .from('inventory_movements')
                .insert(movements)
            if (mvErr) throw mvErr
        }
    },

    async getAppointmentItems(appointmentId: string): Promise<AppointmentItem[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .rpc('get_appointment_items', { p_appointment_id: appointmentId })
        if (error) throw error
        return data ?? []
    },

    // ── Analytics ──────────────────────────────────────────────────────

    async getAbcClassification(clinicId: string, days = 90): Promise<AbcProduct[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .rpc('get_inventory_abc', { p_clinic_id: clinicId, p_days: days })
        if (error) throw error
        return data ?? []
    },

    async getNoRotationProducts(clinicId: string, days = 30): Promise<NoRotationProduct[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .rpc('get_inventory_no_rotation', { p_clinic_id: clinicId, p_days: days })
        if (error) throw error
        return data ?? []
    },

    async getFinanceItemMetrics(clinicId: string, start: Date, end: Date) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .rpc('get_finance_item_metrics', {
                p_clinic_id: clinicId,
                p_start: start.toISOString(),
                p_end: end.toISOString(),
            })
        if (error) throw error
        return data as {
            by_type: Array<{ item_type: string; item_count: number; total_revenue: number; total_units: number }> | null
            top_services: Array<{ name: string; revenue: number; units: number }> | null
            top_products: Array<{ name: string; revenue: number; units: number }> | null
            appt_metrics: { total_appts: number; appts_with_products: number; avg_ticket: number } | null
        }
    },

    // ── Estadísticas rápidas para el banner ────────────────────────────

    async getInventoryStats(clinicId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
            .from('inventory_products')
            .select('id, stock_quantity, min_stock_alert, sale_price, expiry_date, is_active')
            .eq('clinic_id', clinicId)
        if (error) throw error
        const products: any[] = data ?? []
        const active = products.filter((p: any) => p.is_active)
        const today = new Date()
        const in30 = new Date(today); in30.setDate(in30.getDate() + 30)
        return {
            total: active.length,
            lowStock: active.filter((p: any) => p.stock_quantity <= p.min_stock_alert).length,
            expiringSoon: active.filter((p: any) => {
                if (!p.expiry_date) return false
                const exp = new Date(p.expiry_date)
                return exp >= today && exp <= in30
            }).length,
            totalValue: active.reduce((sum: number, p: any) => sum + (p.stock_quantity * p.sale_price), 0),
        }
    },
}
