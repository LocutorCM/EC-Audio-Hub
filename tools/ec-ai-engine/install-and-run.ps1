$ErrorActionPreference = "Stop"
$base = Join-Path $HOME "EC-Audio"
$repo = Join-Path $base "ACE-Step-1.5"
New-Item -ItemType Directory -Force -Path $base | Out-Null
if (-not (Test-Path (Join-Path $repo ".git"))) {
  git clone --depth 1 https://github.com/ace-step/ACE-Step-1.5.git $repo
}
Set-Location $repo
if (Test-Path ".\\start_api_server.bat") {
  cmd /c start_api_server.bat
} else {
  Write-Host "No se encontró el lanzador de Windows. Sigue la guía oficial: https://github.com/ace-step/ACE-Step-1.5"
  exit 1
}
