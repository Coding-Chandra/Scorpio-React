Add-Type -AssemblyName System.Drawing

$root = 'C:\Users\Nishant\.gemini\antigravity\scratch\Scorpio-native'

function Resize-ImageFile {
    param(
        [string]$Path,
        [int]$TargetWidth,
        [int]$TargetHeight,
        [string]$Format = 'png',
        [int]$Quality = 85
    )
    if (-not (Test-Path $Path)) { return }

    # Load original image bytes so file is not locked
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $ms = New-Object System.IO.MemoryStream(,$bytes)
    $img = [System.Drawing.Image]::FromStream($ms)

    $origW = $img.Width
    $origH = $img.Height

    # If TargetHeight is 0, scale proportionally based on TargetWidth
    if ($TargetHeight -eq 0) {
        $ratio = $TargetWidth / $origW
        $TargetHeight = [int]($origH * $ratio)
    }
    # If TargetWidth is 0, scale proportionally based on TargetHeight
    if ($TargetWidth -eq 0) {
        $ratio = $TargetHeight / $origH
        $TargetWidth = [int]($origW * $ratio)
    }

    $bmp = New-Object System.Drawing.Bitmap($TargetWidth, $TargetHeight)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $g.DrawImage($img, 0, 0, $TargetWidth, $TargetHeight)

    $img.Dispose()
    $ms.Dispose()

    if ($Format -eq 'jpg' -or $Format -eq 'jpeg') {
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
        $bmp.Save($Path, $codec, $encoderParams)
        $encoderParams.Dispose()
    } else {
        $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }

    $bmp.Dispose()
    $g.Dispose()

    $newSize = (Get-Item $Path).Length
    Write-Host "Optimized $Path -> $([math]::round($newSize / 1KB, 1)) KB ($TargetWidth x $TargetHeight)"
}

function Resize-MaxDimension {
    param(
        [string]$Path,
        [int]$MaxDim = 1600,
        [string]$Format = 'jpg',
        [int]$Quality = 82
    )
    if (-not (Test-Path $Path)) { return }

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $ms = New-Object System.IO.MemoryStream(,$bytes)
    $img = [System.Drawing.Image]::FromStream($ms)

    $origW = $img.Width
    $origH = $img.Height

    $ratio = [Math]::Min($MaxDim / $origW, $MaxDim / $origH)
    if ($ratio -gt 1) { $ratio = 1 }
    $newW = [int]($origW * $ratio)
    $newH = [int]($origH * $ratio)

    $bmp = New-Object System.Drawing.Bitmap($newW, $newH)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $g.DrawImage($img, 0, 0, $newW, $newH)

    $img.Dispose()
    $ms.Dispose()

    if ($Format -eq 'jpg' -or $Format -eq 'jpeg') {
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
        $bmp.Save($Path, $codec, $encoderParams)
        $encoderParams.Dispose()
    } else {
        $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }

    $bmp.Dispose()
    $g.Dispose()

    $newSize = (Get-Item $Path).Length
    Write-Host "Optimized $Path -> $([math]::round($newSize / 1KB, 1)) KB ($newW x $newH)"
}

Write-Host "=== 1. OPTIMIZING MIPMAP LAUNCHER ICONS ==="
$densities = @(
    @{ Name = 'mipmap-mdpi';    IconSize = 48;  FgSize = 108 },
    @{ Name = 'mipmap-hdpi';    IconSize = 72;  FgSize = 162 },
    @{ Name = 'mipmap-xhdpi';   IconSize = 96;  FgSize = 216 },
    @{ Name = 'mipmap-xxhdpi';  IconSize = 144; FgSize = 324 },
    @{ Name = 'mipmap-xxxhdpi'; IconSize = 192; FgSize = 432 }
)

foreach ($d in $densities) {
    $dir = Join-Path $root "android\app\src\main\res\$($d.Name)"
    $iconPath = Join-Path $dir "ic_launcher.png"
    $roundPath = Join-Path $dir "ic_launcher_round.png"
    $fgPath = Join-Path $dir "ic_launcher_foreground.png"

    Resize-ImageFile -Path $iconPath -TargetWidth $d.IconSize -TargetHeight $d.IconSize -Format 'png'
    Resize-ImageFile -Path $roundPath -TargetWidth $d.IconSize -TargetHeight $d.IconSize -Format 'png'
    Resize-ImageFile -Path $fgPath -TargetWidth $d.FgSize -TargetHeight $d.FgSize -Format 'png'
}

Write-Host "`n=== 2. OPTIMIZING REPEATING NOISE TEXTURE ==="
$noisePath = Join-Path $root "app\src\assets\icons\noise.png"
Resize-ImageFile -Path $noisePath -TargetWidth 256 -TargetHeight 256 -Format 'png'

Write-Host "`n=== 3. OPTIMIZING APP LOGOS ==="
$logo1 = Join-Path $root "app\src\assets\icons\logo.png"
$logo2 = Join-Path $root "src\assets\icons\logo.png"
Resize-ImageFile -Path $logo1 -TargetWidth 512 -TargetHeight 512 -Format 'png'
Resize-ImageFile -Path $logo2 -TargetWidth 512 -TargetHeight 512 -Format 'png'

Write-Host "`n=== 4. OPTIMIZING WALLPAPERS ==="
$wallpapers = Get-ChildItem -Recurse (Join-Path $root "app\src\assets\wallpaper") -Filter "*.jpg"
foreach ($wp in $wallpapers) {
    Resize-MaxDimension -Path $wp.FullName -MaxDim 1600 -Format 'jpg' -Quality 82
}

Write-Host "`n=== DONE ASSET OPTIMIZATION ==="
