# Start Black Box with OpenAI-compatible provider.
# Set BLACKBOX_AI_API_KEY in your environment before running this script —
# do NOT hardcode the key here.
$env:BLACKBOX_AI_PROVIDER = 'openai'
$env:BLACKBOX_AI_MODEL = 'gpt-4o-mini'
$env:BLACKBOX_AI_TIMEOUT_MS = '10000'

$proc = Start-Process -FilePath 'node' -ArgumentList 'packages/blackbox/dist/cli/index.js', 'start' -NoNewWindow -PassThru
Start-Sleep -Seconds 6
if ($proc.HasExited) {
    Write-Host 'SERVER_EXIT_CODE:' $proc.ExitCode
} else {
    Write-Host 'SERVER_PID:' $proc.Id
}
