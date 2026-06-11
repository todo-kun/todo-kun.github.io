# Deployment Notes

## Recommended target

Deploy to Vercel for the simplest Next.js workflow.

## Important production note

The current MVP stores tasks in `data/tasks.json`.
For long-term production use on Vercel, replace this file-based storage with a database such as Postgres or Supabase before relying on it for real task history.

## Before first deploy

1. Push the repository to GitHub
2. Import the repository into Vercel
3. Decide the production task storage
4. If keeping the current MVP temporarily, treat it as a demo or evaluation deployment
5. Set the production domain or Vercel URL
6. Open the app settings screen in the deployed app
7. Save:
   - Google Client ID
   - Google Client Secret
   - Redirect URI
   - Calendar ID
   - Tasks List ID
   - App URL
   - App Secret
8. Update the Google OAuth redirect URI in Google Cloud to match production

## After deploy

- Confirm the setup checklist is fully green
- Connect Google from the browser
- Create a task and confirm it appears in Google Calendar and Google Tasks
- Export a backup and re-import it to verify portability
