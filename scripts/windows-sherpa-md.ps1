$ErrorActionPreference = "Stop"

# Official v* GitHub release ships Windows static /MD libs. crates.io sherpa-onnx-sys
# still auto-downloads /MT (LNK2038 vs llama-cpp-2). Point SHERPA_ONNX_LIB_DIR at MD.

$repoRoot = Split-Path -Parent $PSScriptRoot
$cargoToml = Join-Path $repoRoot "src-tauri/Cargo.toml"
$verMatch = Select-String -Path $cargoToml -Pattern 'sherpa-onnx = \{ version = "([0-9.]+)"'
if (-not $verMatch) {
    throw "Could not read sherpa-onnx version from $cargoToml"
}
$ver = $verMatch.Matches[0].Groups[1].Value

$slug = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") {
    "win-arm64"
} else {
    "win-x64"
}
$stem = "sherpa-onnx-v$ver-$slug-static-MD-Release-lib"
$destRoot = Join-Path $repoRoot "src-tauri/target/sherpa-onnx-prebuilt"
$markerLib = "sherpa-onnx-c-api.lib"

function Find-LibDir([string]$root) {
    Get-ChildItem -Path $root -Recurse -File -Filter $markerLib -ErrorAction SilentlyContinue |
        Select-Object -First 1 |
        ForEach-Object { $_.DirectoryName }
}

$libDir = $null
if (Test-Path $destRoot) {
    $libDir = Find-LibDir $destRoot
}

if (-not $libDir) {
    New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
    $archive = Join-Path $destRoot "$stem.tar.bz2"
    $url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$ver/$stem.tar.bz2"
    Write-Host "Downloading $url"
    curl.exe -fL $url -o $archive
    if ($LASTEXITCODE -ne 0) {
        throw "curl failed: $url"
    }
    tar -xf $archive -C $destRoot
    if ($LASTEXITCODE -ne 0) {
        throw "tar failed: $archive"
    }
    $libDir = Find-LibDir $destRoot
}

if (-not $libDir) {
    throw "Unpacked $stem but did not find $markerLib"
}

$libDir = (Resolve-Path $libDir).Path
Write-Host "SHERPA_ONNX_LIB_DIR=$libDir"
if ($env:GITHUB_ENV) {
    Add-Content -Path $env:GITHUB_ENV -Value "SHERPA_ONNX_LIB_DIR=$libDir"
}
