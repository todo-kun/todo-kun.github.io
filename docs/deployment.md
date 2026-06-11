# Deployment Notes

## Recommended target

Deploy to Vercel for the simplest Next.js workflow.

## Before first deploy

1. Push the repository to GitHub
2. Import the repository into Vercel
3. Set the production domain or Vercel URL
4. Open the app settings screen in the deployed app
5. Save:
   - Google Client ID
   - Google Client Secret
   - Redirect URI
   - Calendar ID
   - Tasks List ID
   - App URL
   - App Secret
6. Update the Google OAuth redirect URI in Google Cloud to match production

## After deploy

- Confirm the setup checklist is fully green
- Connect Google from the browser
- Create a task and confirm it appears in Google Calendar and Google Tasks
- Export a backup and re-import it to verify portability

