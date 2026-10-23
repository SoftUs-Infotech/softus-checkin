# Deploying the web app to Vercel

The web app is a static Vite build. Vercel serves it; the browser calls the API
on AWS directly over HTTPS (see `DEPLOY.md` in the backend repository). Deploy
the API first: the build needs its address.

## 1. Import the project

1. In Vercel: **Add New → Project** → import
   `SoftUs-Infotech/softus-checkin`.
2. Leave **Root Directory** as the repository root.
3. Framework, install and build commands, and the output directory are set by
   `vercel.json`. Leave the overrides off.

## 2. Tell it where the API is

**Settings → Environment Variables:**

| Name | Value | Environments |
|---|---|---|
| `VITE_API_BASE` | `https://api.yourcompany.com/api/v1` | Production |

`https://api.yourcompany.com` on its own works too, with or without a trailing
slash: the app adds `/api/v1` when it is missing. The value is baked into the
bundle at build time, so **redeploy after changing it**. A build on Vercel without it **fails on purpose**: without it the app
would ship pointing at an `/api` path that doesn't exist on Vercel, and every
sign-in would fail.

## 3. Deploy and add the domain

1. **Deploy.** The first build takes about a minute.
2. **Settings → Domains** → add `checkin.yourcompany.com` and create the DNS
   record Vercel shows you. HTTPS is automatic.
3. Back on the API server, set `FRONTEND_URL` and `CORS_ORIGINS` to this
   address and recreate the API container (backend `DEPLOY.md`, step 8). Until
   you do, the browser blocks every API call with a CORS error, and invite
   emails link to the wrong place.

## 4. Check it

- Open the site and sign in with the administrator from the backend `DEPLOY.md`,
  step 7.
- Refresh on a deep link such as `/admin/register`. It should load, not 404:
  `vercel.json` sends every route to the app.
- Punching asks for location permission. Browsers only allow that over HTTPS,
  which Vercel provides.

## What `vercel.json` sets

- **Routing:** every path serves `index.html`, so client-side routes survive a
  refresh.
- **Caching:** hashed files under `/assets/` are cached for a year;
  `index.html` is always revalidated, so a deploy reaches people on their next
  page load.
- **Security headers:** HSTS, no framing, no MIME sniffing, a Permissions
  Policy that allows geolocation for this site only, and a Content Security
  Policy. The CSP allows scripts from this site only, fonts from Google Fonts,
  and API calls to any `https:` origin. To lock API calls down to your API
  alone, change `connect-src 'self' https:` to
  `connect-src 'self' https://api.yourcompany.com`.

## Preview deployments

Every pull request gets its own URL. The production API won't accept them: it
allows exact origins only and refuses origin patterns. That keeps unreviewed
code away from real records. For working previews, deploy a staging API
(backend `DEPLOY.md`, step 8), then set a **Preview**-only `VITE_API_BASE`
pointing at it. Without that, a Vercel build for Preview fails, by design.

## Local development is unchanged

`npm run dev` still proxies `/api` to the local backend. Leave `VITE_API_BASE`
unset locally (see `.env.example`).
