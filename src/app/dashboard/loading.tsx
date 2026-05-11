import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-[320px] w-full rounded-xl" />
            <Skeleton className="h-[320px] w-full rounded-xl" />
          </div>
        </div>
      </div>
    </>
  );
}
