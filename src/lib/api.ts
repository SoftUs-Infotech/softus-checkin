import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios'
import { resetCache } from '@/lib/queryClient'
import { desktop } from './desktop'
import { deviceProfileHeader } from './device'

/**
 * Accepts what people actually paste into Vercel — `https://api.example.com`,
 * the same with a trailing slash, or the full `…/api/v1` — so a near-miss
 * cannot send every request to a path that does not exist.
 */
export function normaliseApiBase(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return '/api/v1'
  return /\/api\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`
}

export const API_BASE = normaliseApiBase(import.meta.env.VITE_API_BASE)

/** The envelope every endpoint returns. */
export interface ApiEnvelope<T> {
  success: boolean
  message: string
  data: T
  meta?: Record<string, unknown> | null
}

export interface ApiErrorBody {
  success: false
  message: string
  data: null
  error: { code: string; details?: unknown }
  meta?: { request_id?: string } | null
}

/** A failure with the server's own wording — never a generic "Request failed". */
export class ApiError extends Error {
  code: string
  status: number
  details?: unknown
  requestId?: string

  constructor(message: string, code: string, status: number, details?: unknown, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
    this.requestId = requestId
  }
}

const TOKEN_KEY = 'softus.tokens'

export interface StoredTokens {
  access_token: string
  refresh_token: string
}

export function readTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    return raw ? (JSON.parse(raw) as StoredTokens) : null
  } catch {
    return null
  }
}

export function writeTokens(tokens: StoredTokens | null) {
  if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
  else localStorage.removeItem(TOKEN_KEY)
}

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const tokens = readTokens()
  if (tokens?.access_token) {
    config.headers.set('Authorization', `Bearer ${tokens.access_token}`)
  }
  // Sent on every request so the server can classify the device on the two
  // routes that care, without the client having to know which those are.
  config.headers.set('X-Device-Profile', deviceProfileHeader())
  // The desktop app says so, and which build it is: the admin sees the version
  // per person, and an outdated app is asked to update before punching in.
  if (desktop) {
    config.headers.set('X-Client', 'desktop')
    config.headers.set('X-App-Version', desktop.version)
    config.headers.set('X-App-Platform', `${desktop.platform}-${desktop.arch}`)
    config.headers.set('X-OS-Version', desktop.osVersion)
  }
  return config
})

/** One refresh at a time; everything else queues behind it. */
let refreshInFlight: Promise<string | null> | null = null
let onSessionLost: (() => void) | null = null

export function setSessionLostHandler(handler: () => void) {
  onSessionLost = handler
}

async function refreshAccessToken(): Promise<string | null> {
  const tokens = readTokens()
  if (!tokens?.refresh_token) return null

  try {
    const response = await axios.post<ApiEnvelope<{ tokens: StoredTokens }>>(
      `${API_BASE}/auth/refresh`,
      { refresh_token: tokens.refresh_token },
      { headers: { 'Content-Type': 'application/json' } },
    )
    const fresh = response.data.data.tokens
    writeTokens(fresh)
    return fresh.access_token
  } catch {
    // The session is over and it did not go through the sign-out button, so
    // nothing else would clear the previous user's cached responses.
    writeTokens(null)
    resetCache()
    return null
  }
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean }
    const status = error.response?.status ?? 0
    const body = error.response?.data

    const isRefreshCall = original?.url?.includes('/auth/refresh')
    if (status === 401 && original && !original._retried && !isRefreshCall) {
      original._retried = true
      refreshInFlight = refreshInFlight ?? refreshAccessToken()
      const token = await refreshInFlight
      refreshInFlight = null

      if (token) {
        original.headers.set('Authorization', `Bearer ${token}`)
        return http(original)
      }
      onSessionLost?.()
    }

    if (body?.error) {
      throw new ApiError(
        body.message,
        body.error.code,
        status,
        body.error.details,
        body.meta?.request_id,
      )
    }
    throw new ApiError(
      error.message === 'Network Error'
        ? 'Cannot reach the server. Check that the API is running.'
        : error.message,
      'NETWORK_ERROR',
      status,
    )
  },
)

/** Unwraps the envelope so callers work with data, not plumbing. */
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const response = await http.get<ApiEnvelope<T>>(url, { params })
  return response.data.data
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const response = await http.post<ApiEnvelope<T>>(url, body ?? {})
  return response.data.data
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const response = await http.patch<ApiEnvelope<T>>(url, body ?? {})
  return response.data.data
}

export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  const response = await http.put<ApiEnvelope<T>>(url, body ?? {})
  return response.data.data
}

export async function apiDelete<T>(url: string): Promise<T> {
  const response = await http.delete<ApiEnvelope<T>>(url)
  return response.data.data
}

/**
 * Sends a file as multipart form data. The client's default JSON content type
 * would make axios serialise the form to JSON, so it is overridden; axios then
 * leaves the header to the browser, which adds the multipart boundary.
 */
export async function apiUpload<T>(
  url: string,
  fields: Record<string, Blob | string | number | null | undefined>,
): Promise<T> {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue
    form.append(key, value instanceof Blob ? value : String(value))
  }
  const response = await http.post<ApiEnvelope<T>>(url, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  })
  return response.data.data
}

/**
 * A link the API handed out, made loadable by the browser. S3 links are
 * absolute already; a locally stored file comes back as a path under the API
 * prefix (`/files?…`), which only means something joined onto `API_BASE`.
 */
export function resolveApiUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${API_BASE}${url}`
}

export function messageOf(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return fallback
}
