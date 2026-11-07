# Compatibility entry for the former NEXT-only installation command.
$ErrorActionPreference = 'Stop'
$PreviousHost = $env:DSH_TAVERN_HOST
try {
  $env:DSH_TAVERN_HOST = 'next'
  $InstallerUrl = 'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@runtime-archive-main/install.ps1'
  $Installer = Invoke-RestMethod -Uri $InstallerUrl -TimeoutSec 30
  & ([scriptblock]::Create($Installer))
} finally {
  $env:DSH_TAVERN_HOST = $PreviousHost
}
