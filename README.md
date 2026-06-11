# Task Sync Hub

Browser-based task management app that can be used from desktop and mobile.
When a task is created in the app, it can also be synced to Google Calendar and Google Tasks.

## Current capabilities

- Browser-only workflow for desktop and phone
- Responsive task creation screen
- Local task storage in `data/tasks.json`
- Google OAuth connect and disconnect flow
- Browser-based settings form for Google and app configuration
- Setup checklist that shows what is still missing before Google connect
- Automatic Google Calendar and Google Tasks sync on task creation
- Task edit, completion toggle, delete, and manual sync retry
- Summary cards and bulk retry for tasks that still need sync
- Backup export and import for moving tasks between browsers
- GitHub Actions CI for lint and build
- PWA manifest so the app can be added to a mobile home screen

## Stack

- Next.js 16
- TypeScript
- App Router
- Google APIs via `googleapis`
- File-based storage for the current MVP

## Setup

1. Install dependencies with `npm install`
2. Copy `.env.example` to `.env.local`
3. In Google Cloud, enable:
   - Google Calendar API
   - Google Tasks API
4. Create an OAuth client and set:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
5. Set app values:
   - `APP_URL`
   - `APP_SECRET`
6. Start the app with `npm run dev`

## Notes about storage

- Tasks are currently stored in `data/tasks.json`
- Google OAuth tokens are stored in an encrypted HTTP-only cookie
- For production, moving tasks to a database is recommended

## Recommended next improvements

- Replace file storage with Postgres or Supabase
- Add task edit and delete flows
- Add background retry for failed syncs
- Add multi-user account support
- Deploy to Vercel and connect a production Google OAuth redirect URL

## GitHub workflow

- Keep `main` deployable
- Create a branch per feature
- Review with pull requests
- Let CI verify lint and build before merge

## Deployment

- Recommended target: Vercel
- Deployment checklist: [docs/deployment.md](docs/deployment.md)
- GitHub publish helper: [docs/github-publish.md](docs/github-publish.md)
