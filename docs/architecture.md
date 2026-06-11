# Architecture Notes

## User flow

When a task is created in the browser:

1. The app validates the request
2. The task is stored locally in the app
3. If Google is connected, the app creates:
   - a Google Calendar event
   - a Google Tasks item
4. The external IDs and sync states are stored with the task

## Current architecture

- Frontend: Next.js App Router
- Backend: Next.js route handlers
- Google auth: OAuth 2.0 with encrypted cookie storage
- Persistence: JSON file storage for MVP
- Mobile access: responsive browser UI + PWA manifest

## Current routes

- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/google/connect`
- `GET /api/google/callback`
- `GET /api/google/status`
- `POST /api/google/disconnect`

## Production direction

- Replace JSON storage with Postgres or Supabase
- Move sync retries to a background job
- Store Google tokens in a server-side session store
- Add user accounts and per-user task ownership
