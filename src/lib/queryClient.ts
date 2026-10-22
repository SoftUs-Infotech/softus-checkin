import { QueryClient } from '@tanstack/react-query'

/*
  The one query client, in its own module.

  It used to be created inside `main.tsx`, which meant nothing outside the React
  tree could reach it — including the auth store, which is where signing in and
  out actually happens. See `resetCache` below for why that mattered.
*/
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A 401 is handled by the interceptor; retrying a 4xx just delays the
      // error the user needs to see.
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status ?? 0
        if (status >= 400 && status < 500) return false
        return failureCount < 2
      },
    },
  },
})

/*
  Throw away everything cached for the person who was signed in.

  Signing out dropped the tokens and the user but left every cached response in
  memory, so the next person to sign in on the same machine was served the last
  one's dashboard, attendance and approval queues from cache before their own
  requests came back. On a shared office computer — which is exactly what this
  product runs on — that is somebody else's record on your screen.

  Called on the way out *and* on the way in: a session can also end by the
  refresh token being rejected, which never passes through the sign-out button.
*/
export function resetCache(): void {
  queryClient.clear()
}
