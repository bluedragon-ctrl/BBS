$ErrorActionPreference = 'Stop'

$port = 8123
$root = $PSScriptRoot
$prefix = "http://localhost:$port/"

$mime = @{
    '.html'  = 'text/html; charset=utf-8'
    '.htm'   = 'text/html; charset=utf-8'
    '.js'    = 'text/javascript; charset=utf-8'
    '.mjs'   = 'text/javascript; charset=utf-8'
    '.css'   = 'text/css; charset=utf-8'
    '.json'  = 'application/json; charset=utf-8'
    '.svg'   = 'image/svg+xml'
    '.png'   = 'image/png'
    '.jpg'   = 'image/jpeg'
    '.jpeg'  = 'image/jpeg'
    '.gif'   = 'image/gif'
    '.ico'   = 'image/x-icon'
    '.woff'  = 'font/woff'
    '.woff2' = 'font/woff2'
    '.ttf'   = 'font/ttf'
    '.txt'   = 'text/plain; charset=utf-8'
    '.wasm'  = 'application/wasm'
    '.map'   = 'application/json; charset=utf-8'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "Failed to bind $prefix : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Another process may be using port $port, or the URL ACL is missing."
    exit 1
}

Write-Host ""
Write-Host " NETROMANCER.BBS - serving $root"
Write-Host " URL: $prefix"
Write-Host " Press Ctrl+C to stop."
Write-Host ""

Start-Process $prefix | Out-Null

$rootFull = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response
        $status = 200
        try {
            $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
            if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
            $rel = $rel -replace '/', '\'
            $candidate = Join-Path $root $rel
            $full = [IO.Path]::GetFullPath($candidate)

            if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -and $full -ne $rootFull.TrimEnd('\')) {
                $status = 403
            } elseif ([IO.Directory]::Exists($full)) {
                $idx = Join-Path $full 'index.html'
                if ([IO.File]::Exists($idx)) { $full = $idx } else { $status = 404 }
            } elseif (-not [IO.File]::Exists($full)) {
                $status = 404
            }

            if ($status -eq 200) {
                $ext = [IO.Path]::GetExtension($full).ToLower()
                $ct = $mime[$ext]
                if (-not $ct) { $ct = 'application/octet-stream' }
                $bytes = [IO.File]::ReadAllBytes($full)
                $res.ContentType = $ct
                $res.ContentLength64 = $bytes.Length
                $res.Headers.Add('Cache-Control', 'no-store')
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $res.StatusCode = $status
                $msg = [Text.Encoding]::UTF8.GetBytes("$status")
                $res.ContentLength64 = $msg.Length
                $res.OutputStream.Write($msg, 0, $msg.Length)
            }

            Write-Host ("{0} {1} {2}" -f $status, $req.HttpMethod, $req.Url.AbsolutePath)
        } catch {
            try {
                $res.StatusCode = 500
            } catch {}
            Write-Host "500 $($req.Url.AbsolutePath) -- $($_.Exception.Message)" -ForegroundColor Red
        } finally {
            try { $res.OutputStream.Close() } catch {}
            try { $res.Close() } catch {}
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Host ""
    Write-Host "Server stopped."
}
