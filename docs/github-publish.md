# GitHub Publish Notes

## Current local state

- The local branch is `main`
- Git user name and email are already configured
- No remote is connected yet

## Simplest publish flow

1. Create an empty GitHub repository in the browser
2. Copy the repository URL
3. Run the local publish helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-to-github.ps1 -RepositoryUrl "https://github.com/<owner>/<repo>.git"
```

## What the script does

- adds `origin` if missing
- updates `origin` if it already exists
- ensures the branch name is `main`
- pushes `main` to GitHub

## After pushing

- Open the repository on GitHub
- Confirm Actions starts on the next push or pull request
- Add the production URL in the app settings after deployment
