import { create } from 'zustand'
import { resetCache } from '@/lib/queryClient'
import { apiGet, apiPost, readTokens, writeTokens } from '@/lib/api'
import type { AuthSession, User } from '@/types'

interface AuthState {
  user: User | null
  status: 'loading' | 'authenticated' | 'anonymous'
  /**
   * Adopt a session the caller already obtained. Signing in is no longer a
   * single call: an administrator with two-factor enabled gets a challenge
   * rather than tokens, so the login screen has to look at the answer before
   * there is a session to adopt.
   */
  adopt: (session: AuthSession) => void
  signOut: () => Promise<void>
  restore: () => Promise<void>
  setUser: (user: User) => void
  isAdmin: () => boolean
  /** A manager decides for their own reports and sees nothing else of admin. */
  isApprover: () => boolean
  /** Whether this account has the personal side of the app at all. */
  hasPersonalSpace: () => boolean
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  status: 'loading',

  adopt(session) {
    // Anything cached belongs to whoever was here before. Clearing on the way
    // in as well as the way out covers a session that ended without the
    // sign-out button — an expired refresh token, or a second tab.
    resetCache()
    writeTokens(session.tokens)
    set({ user: session.user, status: 'authenticated' })
  },

  async signOut() {
    const tokens = readTokens()
    try {
      if (tokens) await apiPost('/auth/logout', { refresh_token: tokens.refresh_token })
    } catch {
      // Signing out locally must succeed even if the server call does not.
    }
    writeTokens(null)
    resetCache()
    set({ user: null, status: 'anonymous' })
  },

  /** Called once on boot: a stored token means we can skip the login screen. */
  async restore() {
    if (!readTokens()) {
      set({ user: null, status: 'anonymous' })
      return
    }
    try {
      const user = await apiGet<User>('/auth/me')
      set({ user, status: 'authenticated' })
    } catch {
      writeTokens(null)
      set({ user: null, status: 'anonymous' })
    }
  },

  setUser(user) {
    set({ user })
  },

  hasPersonalSpace() {
    const user = get().user
    return !!user && user.can_punch !== false
  },

  isApprover() {
    const role = get().user?.role
    return role === 'ADMIN' || role === 'MANAGER'
  },

  isAdmin() {
    return get().user?.role === 'ADMIN'
  },
}))
