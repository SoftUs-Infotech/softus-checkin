import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CheckCheck, Inbox } from 'lucide-react'
import { apiGet, apiPost } from '@/lib/api'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/components/ui'
import type { Notification, Paginated } from '@/types'

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiGet<Paginated<Notification>>('/notifications', { page_size: 12 }),
  })

  const markRead = useMutation({
    mutationFn: (id: string) => apiPost(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
  })

  const markAllRead = useMutation({
    mutationFn: () => apiPost('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
  })

  const items = data?.items ?? []

  return (
    <>
      <button
        type="button"
        aria-label="Close notifications"
        className="fixed inset-0 z-30 cursor-default"
        onClick={onClose}
      />
      <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg">
        <header className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
          <h2 className="text-[14px] text-ink-900">Notifications</h2>
          {items.some((item) => !item.read_at) && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              className="flex items-center gap-1 text-[12px] text-brand-700 hover:underline"
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </button>
          )}
        </header>

        <div className="scrollbar-thin max-h-[26rem] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 px-4 py-4" aria-busy="true" aria-label="Loading">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex gap-2">
                  <Skeleton className="mt-1.5 size-1.5 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
              <Inbox className="size-5 text-ink-300" />
              <p className="text-[13px] text-ink-400">Nothing new right now.</p>
            </div>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!item.read_at) markRead.mutate(item.id)
                      if (item.link) {
                        navigate(item.link)
                        onClose()
                      }
                    }}
                    className={cn(
                      'w-full border-b border-ink-50 px-4 py-3 text-left transition-colors hover:bg-ink-50',
                      !item.read_at && 'bg-brand-50/40',
                    )}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0 rounded-full',
                          item.read_at ? 'bg-transparent' : 'bg-brand-600',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-ink-900">
                          {item.title}
                        </span>
                        {item.body && (
                          <span className="mt-0.5 block line-clamp-2 text-[12px] text-ink-500">
                            {item.body}
                          </span>
                        )}
                        <span className="tabular mt-1 block text-[11px] text-ink-300">
                          {relativeTime(item.created_at)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
