# Softus Checkin — Frontend

React single-page app for the employee attendance and management system.

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · TanStack Query · Zustand ·
react-hook-form + zod · react-router.

UI primitives are hand-written in [`src/components/ui`](src/components/ui/index.tsx)
rather than pulled from a component library — the app needs about a dozen
components, and owning them keeps the bundle and the styling under control.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

The API is a separate repository (FastAPI + MongoDB); run it on port 8000.

`/api` is proxied to `http://127.0.0.1:8000` so the browser talks to one origin
in development, exactly as it will in production. Point it somewhere else with
`VITE_API_TARGET=http://127.0.0.1:8001 npm run dev`.

```bash
npm run build      # typecheck + production build
npx tsc -b --noEmit
```

## Deploying

To Vercel — see [`DEPLOY.md`](DEPLOY.md). The only setting it needs is
`VITE_API_BASE`, the API's public address.

## Layout

```
src/
  lib/         api client (envelope unwrapping, token refresh), device profile, formatting
  store/       auth session
  types/       mirrors of the backend schemas
  components/  ui primitives · app shell · notification panel
  features/
    auth/        sign in, accept invite, forgot/reset password
    dashboard/   punch card, month calendar, right-hand rail
    attendance/  history
    corrections/ request and track regularisations
    tasks/       daily task log and its review timeline
    leave/       balances, applying, history
    profile/     own details and password
    admin/       register · approvals · employees · shifts · leave types ·
                 holidays · announcements · audit trail · settings
```

## Design notes

**Colour is reserved for the record.** Green, amber, red, violet and yellow all
mean something specific on the attendance calendar, so the interface itself is
ink and paper — the brand ramp is achromatic and cannot be confused with any of
them. The reasoning is at the top of [`src/index.css`](src/index.css).
[`statusStyle`](src/lib/format.ts) is the only place a status colour becomes CSS,
so the calendar, the day drawer and the daily register can never disagree.

**Times are monospaced.** Durations and punch times use IBM Plex Mono with
tabular figures — a timesheet whose columns do not line up is a timesheet nobody
reads.

**The ledger bar** on the dashboard draws the employee's shift: the fill is
hours worked, and the tick marks are the half-day and full-day thresholds taken
from that employee's shift. The same idea repeats as a micro-bar in each
calendar cell, so a month reads as a chart rather than a grid of coloured
squares.

## The desktop-only rule

Every request carries an `X-Device-Profile` header built in
[`src/lib/device.ts`](src/lib/device.ts) from `navigator.maxTouchPoints`,
`matchMedia('(pointer: coarse)')` and the screen size. The server decides; the
client only reports, and separately shows an explanation before the employee
presses anything.

A touch laptop is allowed through because it still has a trackpad and so reports
a fine pointer. A phone, and an iPad in desktop mode, cannot hide having neither.

## Sessions

The axios interceptor refreshes an expired access token once and retries the
original request. If the refresh token is dead — revoked, reused, or the account
was suspended — the app clears the session and returns to the sign-in screen
rather than leaving a page full of failed requests.
