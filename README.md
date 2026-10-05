# Kandong – Habal Ride PWA

Installable Progressive Web App for rider + passenger habal bookings.

**Stack:** Vanilla JS • Supabase (REST + Realtime) • Service Worker • Web App Manifest

## Features

- **Passenger mode** – book ride, live tracking UI, fare estimate
- **Rider mode** – go online, accept bookings, update status
- **Supabase** – bookings table + polling / Realtime ready
- **PWA** – installs to home screen / app drawer, offline shell
- **No build step** – open or deploy as static files

## Quick start (GitHub Pages)

1. Unzip / clone this folder.
2. In Supabase:
   - Create a project (or use existing).
   - Run `sql/bookings.sql` in the SQL Editor.
   - Copy **Project URL** + **anon public key**.
3. Optional: edit `js/config.js` and paste the anon key (or use in-app ⚙️ Settings).
4. Push to GitHub → enable **Pages** (Deploy from `main` / root).
5. Open the live URL on mobile → **Install** / Add to Home Screen.

## Local test

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open `http://localhost:8080` on phone (same Wi‑Fi) or Chrome desktop → Application → Install.

## PWA install (app drawer)

| Platform | How |
|----------|-----|
| **Android Chrome** | Banner “INSTALL” or ⋮ → Install app → appears in app drawer |
| **iOS Safari** | Share → Add to Home Screen |
| **Desktop Chrome** | Address bar install icon / ⋮ → Install Kandong |

Requirements met:

- HTTPS (or localhost)
- Valid `manifest.webmanifest` with `display: standalone`
- Icons 192 + 512 (any + maskable)
- Registered service worker
- `start_url` within scope

## Security note

The included RLS policy is **open for prototype only**.  
Before real traffic, lock policies to authenticated users and avoid shipping the anon key in public client if you move sensitive logic server-side.

## Credits

Edwin Macatangay Perez · [@chib_e](https://instagram.com/chib_e) · v1.2.0 · 2026
