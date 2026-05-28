
import { useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
  getEffectivePermissions,
  type MemberPermissions,
  type PageKey,
  type ActionKey,
  type UserRole,
} from '@/lib/permissions'

export function usePermissions() {
  const { member, profile } = useAuth()

  const permissions = useMemo((): MemberPermissions | null => {
    const role = (member?.role ?? profile?.role) as UserRole | undefined
    if (!role) return null
    return getEffectivePermissions(role, (member as any)?.permissions ?? null)
  }, [member, profile?.role])

  // Fail-open while loading (permissions === null means not yet resolved)
  const canAccess = (page: PageKey): boolean => {
    if (!permissions) return true
    return permissions.pages[page] ?? false
  }

  const can = (action: ActionKey): boolean => {
    if (!permissions) return true
    return permissions.actions[action] ?? false
  }

  return { canAccess, can, permissions }
}
