[CmdletBinding()]
param(
  [string]$ProjectRef = "jayzswkabxfhzmftagku",
  [string]$OutputPath = ".local/supabase-migration-volume.json"
)
$ErrorActionPreference = "Stop"
$dir=Split-Path -Parent $OutputPath
if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$query=@"
select n.nspname schema_name,
       count(*) table_count,
       coalesce(sum(s.n_live_tup),0) estimated_rows,
       coalesce(sum(pg_total_relation_size(c.oid)),0) bytes_total
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
left join pg_stat_user_tables s on s.relid=c.oid
where n.nspname in ('public','auth','storage') and c.relkind='r'
group by n.nspname order by n.nspname;
"@
[pscustomobject]@{
  version=1
  generatedAtUtc=[DateTime]::UtcNow.ToString("o")
  projectRef=$ProjectRef
  policy="metadata-first; no data export"
  query=$query.Trim()
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath $OutputPath
Write-Host "Préflight enregistré: $OutputPath"
Write-Host "Ce script ne télécharge aucune donnée et ne modifie aucun projet."
