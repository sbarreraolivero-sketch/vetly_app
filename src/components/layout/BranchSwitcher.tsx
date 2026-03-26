import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
    ChevronsUpDown,
    Check,
    Plus,
    Building2,
    Store
} from 'lucide-react'
import { cn } from '@/lib/utils'
import CreateBranchModal from './CreateBranchModal'

export default function BranchSwitcher() {
    const { clinics, profile, switchClinic, subscription } = useAuth()
    const [isOpen, setIsOpen] = useState(false)
    const [showCreateModal, setShowCreateModal] = useState(false)

    // Current active clinic
    const currentClinic = clinics.find(c => c.clinic_id === profile?.clinic_id)

    const handleSwitch = (clinicId: string) => {
        if (clinicId === profile?.clinic_id) return
        switchClinic(clinicId)
        setIsOpen(false)
    }

    // Check if user has Prestige plan to allow creating branches
    // We check the subscription of the current clinic mostly, but technically 
    // the user should be Owner of at least one Prestige clinic.
    // The RPC `create_clinic_branch` handles the strict check.
    // Here we can just show the button if they have 'prestige' in the current context or any clinic.
    const canCreateBranch = clinics.some(c => c.plan === 'prestige') || subscription?.plan === 'prestige'

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-2 rounded-soft hover:bg-silk-beige/50 transition-colors border border-transparent hover:border-silk-beige group"
            >
                <div className="flex items-center gap-3 min-w-0 text-left">
                    <div className="w-8 h-8 bg-primary-100 text-primary-600 rounded-soft flex items-center justify-center shrink-0">
                        <Store className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-charcoal truncate">
                            {currentClinic?.clinic_name || 'Mi Clínica'}
                        </p>
                        <p className="text-xs text-charcoal/50 truncate">
                            {currentClinic?.address || (currentClinic?.role === 'owner' ? 'Dueño' : 'Equipo')}
                        </p>
                    </div>
                </div>
                <ChevronsUpDown className="w-4 h-4 text-charcoal/40 group-hover:text-charcoal/60" />
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-soft shadow-soft-lg border border-silk-beige z-50 py-1 max-h-80 overflow-auto">
                        <div className="px-2 py-1.5 text-xs font-semibold text-charcoal/40 uppercase tracking-wider">
                            Sucursales
                        </div>

                        {clinics.map((clinic) => (
                            <button
                                key={clinic.clinic_id}
                                onClick={() => handleSwitch(clinic.clinic_id)}
                                className={cn(
                                    "w-full flex items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-silk-beige/30",
                                    clinic.clinic_id === profile?.clinic_id ? "bg-primary-50/50 text-primary-700" : "text-charcoal/80"
                                )}
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 truncate">
                                        <Building2 className="w-3.5 h-3.5 opacity-70" />
                                        <span className="truncate font-medium">{clinic.clinic_name}</span>
                                    </div>
                                    {clinic.address && (
                                        <p className="text-xs text-charcoal/50 truncate pl-5.5">
                                            {clinic.address}
                                        </p>
                                    )}
                                </div>
                                {clinic.clinic_id === profile?.clinic_id && (
                                    <Check className="w-3.5 h-3.5 text-primary-600 shrink-0" />
                                )}
                            </button>
                        ))}

                        {canCreateBranch && (
                            <div className="border-t border-silk-beige mt-1 pt-1 px-1">
                                <button
                                    onClick={() => {
                                        setIsOpen(false)
                                        setShowCreateModal(true)
                                    }}
                                    className="w-full flex items-center gap-2 px-2 py-2 text-sm text-charcoal/60 hover:text-primary-600 hover:bg-silk-beige/30 rounded-soft transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                    Nueva Sucursal
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            <CreateBranchModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onSuccess={() => {
                    // Refresh handled by modal's internal switchClinic
                }}
            />
        </div>
    )
}
