import { cn } from "@/lib/utils"

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-charcoal/5", className)}
    />
  )
}

export function TutorRowSkeleton() {
  return (
    <tr className="border-b border-silk-beige">
      <td className="py-4 px-6">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      </td>
      <td className="py-4 px-6">
        <Skeleton className="h-5 w-16 rounded-full" />
      </td>
      <td className="py-4 px-6">
        <div className="flex gap-1">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-12" />
        </div>
      </td>
      <td className="py-4 px-6 text-right">
        <div className="flex justify-end gap-2">
          <Skeleton className="w-8 h-8 rounded-soft" />
          <Skeleton className="w-8 h-8 rounded-soft" />
        </div>
      </td>
    </tr>
  )
}

export function TutorCardSkeleton() {
    return (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-silk-beige flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-20" />
                    </div>
                </div>
                <Skeleton className="h-4 w-16 rounded-full" />
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-silk-beige/30">
                <div className="flex gap-1">
                    <Skeleton className="h-3 w-10" />
                    <Skeleton className="h-3 w-10" />
                </div>
                <div className="flex gap-1">
                    <Skeleton className="w-7 h-7 rounded-lg" />
                    <Skeleton className="w-7 h-7 rounded-lg" />
                </div>
            </div>
        </div>
    )
}
export function PatientRowSkeleton() {
  return (
    <tr className="border-b border-silk-beige">
      <td className="py-4 px-6">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </td>
      <td className="py-4 px-6">
        <Skeleton className="h-4 w-20" />
      </td>
      <td className="py-4 px-6">
        <Skeleton className="h-4 w-24" />
      </td>
      <td className="py-4 px-6">
        <Skeleton className="h-4 w-16" />
      </td>
      <td className="py-4 px-6 text-right">
        <Skeleton className="w-5 h-5 ml-auto" />
      </td>
    </tr>
  )
}
