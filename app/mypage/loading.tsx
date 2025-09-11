import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

// ローディング状態のスケルトンUI
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        {/* ページタイトルのスケルトン */}
        <div className="mb-8 text-center">
          <Skeleton className="h-9 w-48 mx-auto mb-2" />
          <Skeleton className="h-5 w-64 mx-auto" />
        </div>

        {/* メインカードのスケルトン */}
        <Card className="shadow-md border-0 rounded-2xl">
          <CardHeader className="pb-4">
            <Skeleton className="h-7 w-80" />
            <Skeleton className="h-5 w-96" />
          </CardHeader>

          <CardContent className="space-y-6">
            {/* ボタン群のスケルトン */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>

            {/* 注意事項のスケルトン */}
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
