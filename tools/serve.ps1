# Minimal static file server for local preview (no Node or Python required).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 5173
param([int]$Port = 5173)

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Output "Serving $root on http://127.0.0.1:$Port/"

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.json' = 'application/json; charset=utf-8'
}

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $path = $context.Request.Url.LocalPath
    if ($path -eq '/') { $path = '/index.html' }
    $file = Join-Path $root ($path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar))

    if (Test-Path -LiteralPath $file -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $context.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $context.Response.Headers.Add('Cache-Control', 'no-store')
      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $context.Response.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      $context.Response.OutputStream.Write($body, 0, $body.Length)
    }
    $context.Response.OutputStream.Close()
  } catch {
    Write-Output "request error: $($_.Exception.Message)"
  }
}
