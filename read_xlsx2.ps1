Add-Type -AssemblyName System.IO.Compression.FileSystem

$xlsxPath = [System.IO.Path]::GetFullPath("C:\Users\storm\Desktop\3.1-16" + [char]25285 + [char]38899 + [char]25773 + [char]25918 + ".xlsx")

# fallback: search by wildcard
$found = Get-ChildItem "C:\Users\storm\Desktop\" -Filter "*.xlsx" | Select-Object -First 1
if ($found) { $xlsxPath = $found.FullName }
Write-Output "File: $xlsxPath"

$zip = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)

# Read shared strings
$shared = @()
$sstEntry = $zip.Entries | Where-Object { $_.FullName -eq "xl/sharedStrings.xml" }
if ($sstEntry) {
    $reader = New-Object System.IO.StreamReader($sstEntry.Open())
    [xml]$sst = $reader.ReadToEnd()
    $reader.Close()
    $ns = New-Object System.Xml.XmlNamespaceManager($sst.NameTable)
    $ns.AddNamespace("ns","http://schemas.openxmlformats.org/spreadsheetml/2006/main")
    foreach ($si in $sst.SelectNodes("//ns:si", $ns)) {
        $texts = $si.SelectNodes(".//ns:t", $ns)
        $str = ""
        foreach ($t in $texts) { $str += $t.InnerText }
        $shared += $str
    }
}
Write-Output "SharedStrings count: $($shared.Count)"
Write-Output "First 5: $($shared[0..4] -join ' | ')"

# Read sheet1
$sheetEntry = $zip.Entries | Where-Object { $_.FullName -match "xl/worksheets/sheet1\.xml" }
$reader2 = New-Object System.IO.StreamReader($sheetEntry.Open())
[xml]$sheet = $reader2.ReadToEnd()
$reader2.Close()

$nsm = New-Object System.Xml.XmlNamespaceManager($sheet.NameTable)
$nsm.AddNamespace("ns","http://schemas.openxmlformats.org/spreadsheetml/2006/main")

$rows = $sheet.SelectNodes("//ns:row", $nsm)
$rowCount = 0
foreach ($row in $rows) {
    if ($rowCount -ge 6) { break }
    $cells = $row.SelectNodes("ns:c", $nsm)
    $vals = @()
    foreach ($c in $cells) {
        $t = $c.GetAttribute("t")
        $vNode = $c.SelectSingleNode("ns:v", $nsm)
        $val = if ($vNode) { $vNode.InnerText } else { "" }
        if ($t -eq "s") {
            $idx = [int]$val
            $val = if ($idx -lt $shared.Count) { $shared[$idx] } else { "?" }
        }
        $vals += $val
    }
    Write-Output ($vals -join " | ")
    $rowCount++
}

$zip.Dispose()
