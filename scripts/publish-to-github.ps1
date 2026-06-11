param(
  [Parameter(Mandatory = $true)]
  [string]$RepositoryUrl,

  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

$remoteExists = git remote

if ($remoteExists -contains "origin") {
  git remote set-url origin $RepositoryUrl
} else {
  git remote add origin $RepositoryUrl
}

git branch -M $Branch
git push -u origin $Branch
