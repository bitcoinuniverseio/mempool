[CmdletBinding()]
param (
    [ValidateSet('changed', 'full', 'review', 'production-parity')]
    [string]$Mode = 'changed',
    [string]$Candidate,
    [string]$ReferenceRef,
    [string]$Reference,
    [string]$Routes,
    [string]$Scenarios,
    [string]$Browsers,
    [string]$Viewports,
    [string]$Themes,
    [string]$Out,
    [switch]$UpdateReviewRecord,
    [switch]$Headed,
    [switch]$DebugMode
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$runnerScript = Join-Path $repoRoot "scripts\universe\visual-qa\checkscreenshots.mjs"

$argsList = @("--mode=$Mode")

if ($Candidate) { $argsList += "--candidate=$Candidate" }
if ($ReferenceRef) { $argsList += "--reference-ref=$ReferenceRef" }
if ($Reference) { $argsList += "--reference=$Reference" }
if ($Routes) { $argsList += "--routes=$Routes" }
if ($Scenarios) { $argsList += "--scenarios=$Scenarios" }
if ($Browsers) { $argsList += "--browsers=$Browsers" }
if ($Viewports) { $argsList += "--viewports=$Viewports" }
if ($Themes) { $argsList += "--themes=$Themes" }
if ($Out) { $argsList += "--out=$Out" }
if ($UpdateReviewRecord) { $argsList += "--update-review-record" }
if ($Headed) { $argsList += "--headed" }
if ($DebugMode) { $argsList += "--debug" }

Write-Host "Invoking checkscreenshots: node $runnerScript $argsList" -ForegroundColor Cyan
& node $runnerScript $argsList
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
