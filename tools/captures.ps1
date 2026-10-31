# Prépare les captures d'écran de l'application pour la page « Comment ça marche »
# (/fr/fonctionnement/ et /en/how-it-works/) : copie, renommage, recadrage et floutage
# des informations personnelles (chemins de fichiers, noms de sites dans les tags…).
#
# Utilisation, depuis la racine du dépôt WEB :
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\captures.ps1
# Par défaut, les captures sont lues dans ..\APPLI\Docs et écrites dans images\app.
# Autres dossiers : -Src "chemin\des\captures" -Dst "chemin\de\sortie"
#
# Pour ajouter ou remplacer une capture :
#   1. Ajouter une ligne dans $jobs : nom publié | fin du nom de la capture source | recadrage | zones à flouter.
#      La capture source est retrouvée par la fin de son nom (ex. « 213335 » pour « Capture d'écran 2026-10-31 213335.png »).
#   2. Les coordonnées sont en pixels dans la capture d'origine, sous la forme « x1,y1,x2,y2 »
#      (coin haut gauche, coin bas droit) ; plusieurs zones sont séparées par « ; ».
#      Le recadrage est appliqué après le floutage, donc avec les mêmes coordonnées d'origine.
#   3. Relancer le script, puis vérifier visuellement chaque image floutée : le texte ne doit plus être lisible.
#   4. Si une image change de dimensions, mettre à jour width/height dans les deux pages.
#
# Aucun outil à installer : le script utilise System.Drawing, fourni avec Windows.

param(
  [string]$Src = (Join-Path $PSScriptRoot '..\..\APPLI\Docs'),
  [string]$Dst = (Join-Path $PSScriptRoot '..\images\app')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $Dst | Out-Null

function Blur([System.Drawing.Bitmap]$bmp, [string]$zone) {
  $r = $zone.Split(',') | ForEach-Object { [int]$_ }
  $rect = New-Object System.Drawing.Rectangle($r[0], $r[1], ($r[2] - $r[0]), ($r[3] - $r[1]))
  $part = $bmp.Clone($rect, $bmp.PixelFormat)
  # Réduction forte puis agrandissement lissé ; TileFlipXY évite le mélange avec du transparent sur les bords.
  $sw = [Math]::Max(2, [int]($rect.Width / 12)); $sh = [Math]::Max(2, [int]($rect.Height / 8))
  $attr = New-Object System.Drawing.Imaging.ImageAttributes
  $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $small = New-Object System.Drawing.Bitmap($sw, $sh, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.InterpolationMode = 'HighQualityBilinear'
  $g.DrawImage($part, (New-Object System.Drawing.Rectangle(0, 0, $sw, $sh)), 0, 0, $part.Width, $part.Height, 'Pixel', $attr); $g.Dispose()
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBilinear'
  $g.DrawImage($small, $rect, 0, 0, $sw, $sh, 'Pixel', $attr); $g.Dispose()
  $small.Dispose(); $part.Dispose()
}

# nom publié | capture source | recadrage (vide si aucun) | zones à flouter "x1,y1,x2,y2" séparées par ;
$tags  = '472,496,812,520;472,552,1055,576'   # titres/albums contenant des noms de sites (playvk, djblaze)
$paths = '906,688,1456,740'                   # colonne « Chemin » du détail d'un groupe
$jobs = @(
  '01-accueil|213335||',
  '02-dossiers|213505||38,166,622,200;38,270,622,302',
  '03-collection|213415||',
  '04-analyse-en-cours|213523||',
  '05-resultats|213716||',
  "06-detail-groupe|213805||$tags;$paths",
  "07-groupe-valide|213910||$tags;$paths",
  '08-apercu-detail|214028|0,0,1206,752|98,629,1000,646;146,655,1000,672',
  '09-apercu-confirmation|214210||',
  "10-simulation|214114||213,348,806,378;160,926,770,941;833,556,925,571;$paths",
  '11-nettoyage-effectue|214312||128,172,748,203',
  '12-apres-nettoyage|214327||472,496,812,520;472,524,1055,548;160,926,770,941',
  '13-historique|214419||',
  '14-confirmation-restauration|214438||',
  '15-restauration-effectuee|215531||'
)

foreach ($line in $jobs) {
  $name, $id, $crop, $zones = $line.Split('|')
  $file = Get-ChildItem $Src -Filter "*$id.png" | Select-Object -First 1
  if (-not $file) { Write-Warning "Capture introuvable pour « $name » (*$id.png dans $Src) : ignorée."; continue }
  $img = [System.Drawing.Image]::FromFile($file.FullName)
  $bmp = New-Object System.Drawing.Bitmap($img); $img.Dispose()
  if ($zones) { foreach ($z in $zones.Split(';')) { Blur $bmp $z } }
  if ($crop) {
    $c = $crop.Split(',') | ForEach-Object { [int]$_ }
    $rect = New-Object System.Drawing.Rectangle($c[0], $c[1], ($c[2] - $c[0]), ($c[3] - $c[1]))
    $cut = $bmp.Clone($rect, $bmp.PixelFormat); $bmp.Dispose(); $bmp = $cut
  }
  $out = Join-Path $Dst "$name.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  "{0,-34} {1}x{2}  {3} Ko" -f "$name.png", $bmp.Width, $bmp.Height, [int]((Get-Item $out).Length / 1KB)
  $bmp.Dispose()
}
