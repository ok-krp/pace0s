[CmdletBinding()]
param(
  [string]$ProjectRef = "jayzswkabxfhzmftagku",
  [string]$BackupRoot = ".local/supabase-backup"
)

$ErrorActionPreference = "Stop"

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Commande introuvable: $Name"
  }
}

function Invoke-Step([string]$Title, [scriptblock]$Action) {
  Write-Host ""
  Write-Host "=== $Title ===" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "Échec: $Title (exit code $LASTEXITCODE)"
  }
}

function Assert-BackupFile([string]$File, [string]$Label) {
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
    throw "Backup absent: $Label ($File)"
  }

  $item = Get-Item -LiteralPath $File
  if ($item.Length -le 0) {
    throw "Backup vide: $Label ($File)"
  }
}

Assert-Command "supabase"
Assert-Command "docker"

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

Write-Host "PaceOS Supabase local migration" -ForegroundColor Green
Write-Host "Project: $ProjectRef"
Write-Host "Backup:  $BackupRoot"

Invoke-Step "Linker le projet distant" {
  supabase link --project-ref $ProjectRef
}

Invoke-Step "Capturer le schéma distant sans modifier le Cloud" {
  supabase db pull --linked --no-apply
}

Write-Host ""
Write-Host "Capture auth/storage personnalisés..."
supabase db pull --linked --schema auth,storage --no-apply
$managedPullCode = $LASTEXITCODE
if ($managedPullCode -ne 0) {
  Write-Host "auth/storage: aucun diff exploitable ou CLI non-compatible (code $managedPullCode)." -ForegroundColor Yellow
}

Invoke-Step "Exporter le schéma public" {
  supabase db dump --linked --schema public -f "$BackupRoot/remote-public-schema.sql"
}

Invoke-Step "Exporter les données public" {
  supabase db dump --linked --data-only --use-copy --schema public -f "$BackupRoot/remote-public-data.sql"
}

Invoke-Step "Exporter les données Auth" {
  supabase db dump --linked --data-only --use-copy --schema auth -f "$BackupRoot/remote-auth-data.sql"
}

Invoke-Step "Exporter les données Storage" {
  supabase db dump --linked --data-only --use-copy --schema storage -f "$BackupRoot/remote-storage-data.sql"
}

$backupFiles = @(
  "$BackupRoot/remote-public-schema.sql",
  "$BackupRoot/remote-public-data.sql",
  "$BackupRoot/remote-auth-data.sql",
  "$BackupRoot/remote-storage-data.sql"
)

foreach ($file in $backupFiles) {
  Assert-BackupFile $file $file
}

# The manifest records immutable size and SHA-256 metadata for every export.
$manifest = foreach ($file in $backupFiles) {
  $item = Get-Item -LiteralPath $file
  [pscustomobject]@{
    file = [IO.Path]::GetFileName($file)
    bytes = $item.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
  }
}

$manifestPath = Join-Path $BackupRoot "manifest.json"
[pscustomobject]@{
  format = 1
  createdAtUtc = [DateTime]::UtcNow.ToString("o")
  projectRef = $ProjectRef
  files = @($manifest)
} | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath $manifestPath

Write-Host "Manifest SHA-256 écrit: $manifestPath" -ForegroundColor DarkGray

Invoke-Step "Démarrer Supabase local" {
  supabase start
}

Invoke-Step "Reconstruire la base locale depuis les migrations" {
  supabase db reset --local
}

$container = docker ps --format "{{.Names}}" | Where-Object { $_ -like "supabase_db_*" } | Select-Object -First 1
if (-not $container) {
  throw "Conteneur Postgres Supabase local introuvable après 'supabase start'."
}

function Restore-Sql([string]$File, [string]$Label) {
  Assert-BackupFile $File $Label

  Write-Host ""
  Write-Host "=== Restaurer $Label ===" -ForegroundColor Cyan

  # Stream the dump instead of loading the entire file into PowerShell memory.
  Get-Content -LiteralPath $File | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SET session_replication_role = replica;" -f -
  if ($LASTEXITCODE -ne 0) {
    throw "Échec restauration: $Label"
  }
}

Restore-Sql "$BackupRoot/remote-auth-data.sql" "Auth"
Restore-Sql "$BackupRoot/remote-public-data.sql" "public"
Restore-Sql "$BackupRoot/remote-storage-data.sql" "Storage"

Invoke-Step "Vérifier la base locale" {
  supabase status
}

Write-Host ""
Write-Host "Migration locale terminée." -ForegroundColor Green
Write-Host "Manifest: $manifestPath"
Write-Host "Les backups restent dans $BackupRoot et sont exclus de Git."
Write-Host "Cloud non modifié par ce script."
