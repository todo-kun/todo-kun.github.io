# GitHub Publish Notes

## Current local state

- The local branch is `main`
- Git user name and email are already configured
- Target repository: `https://github.com/todo-kun/todo-kun.github.io.git`

## Simplest publish flow

1. Use the GitHub repository `todo-kun/todo-kun.github.io`
2. Run the local publish helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-to-github.ps1 -RepositoryUrl "https://github.com/todo-kun/todo-kun.github.io.git"
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
