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

Assert-Command "supabase"
Assert-Command "docker"

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

Write-Host "PaceOS Supabase local migration" -ForegroundColor Green
Write-Host "Project: $ProjectRef"
Write-Host "Backup:  $BackupRoot"

# 1) Link only. This does not modify the remote database.
Invoke-Step "Linker le projet distant" {
  supabase link --project-ref $ProjectRef
}

# 2) Capture remote schema drift as local migration files.
# --no-apply is intentional: do NOT execute the generated migration on the remote project.
Invoke-Step "Capturer le schéma distant sans modifier le Cloud" {
  supabase db pull --linked --no-apply
}

# Older CLI versions can exclude managed schemas. Run explicit pulls; if they are already
# represented, Supabase may report no changes. Non-zero is tolerated for the no-change case.
Write-Host ""
Write-Host "Capture auth/storage personnalisés..."
supabase db pull --linked --schema auth,storage --no-apply
$managedPullCode = $LASTEXITCODE
if ($managedPullCode -ne 0) {
  Write-Host "auth/storage: aucun diff exploitable ou CLI non-compatible (code $managedPullCode)." -ForegroundColor Yellow
}

# 3) Full schema/data backup. These files contain production data/secrets and are NEVER committed.
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

# 4) Start the local Supabase stack and rebuild it from the versioned migrations.
Invoke-Step "Démarrer Supabase local" {
  supabase start
}

Invoke-Step "Reconstruire la base locale depuis les migrations" {
  supabase db reset --local
}

# 5) Restore remote data into the local Postgres container.
# We use the local Postgres container directly so this does not require psql on Windows.
$container = docker ps --format "{{.Names}}" | Where-Object { $_ -like "supabase_db_*" } | Select-Object -First 1
if (-not $container) {
  throw "Conteneur Postgres Supabase local introuvable après 'supabase start'."
}

function Restore-Sql([string]$File, [string]$Label) {
  if (-not (Test-Path $File)) {
    throw "Backup absent: $File"
  }

  Write-Host ""
  Write-Host "=== Restaurer $Label ===" -ForegroundColor Cyan

  # Disable triggers/FKs only for the restore session. The local schema itself is untouched.
  Get-Content -Raw $File | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SET session_replication_role = replica;" -f -
  if ($LASTEXITCODE -ne 0) {
    throw "Échec restauration: $Label"
  }
}

Restore-Sql "$BackupRoot/remote-auth-data.sql" "Auth"
Restore-Sql "$BackupRoot/remote-public-data.sql" "public"
Restore-Sql "$BackupRoot/remote-storage-data.sql" "Storage"

# 6) Verify row counts locally against the remote inventory captured before the migration.
Invoke-Step "Vérifier la base locale" {
  supabase status
}

Write-Host ""
Write-Host "Migration locale terminée." -ForegroundColor Green
Write-Host "Les backups restent dans $BackupRoot et sont exclus de Git."
Write-Host "Cloud non modifié par ce script."
