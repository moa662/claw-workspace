$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open('C:\Users\storm\Desktop\3.1-16抖音播放.xlsx')
$ws = $wb.Sheets.Item(1)
$rows = $ws.UsedRange.Rows.Count
$cols = $ws.UsedRange.Columns.Count
Write-Output "行数=$rows 列数=$cols"
for($c=1;$c -le $cols;$c++){
  $v = $ws.Cells.Item(1,$c).Value2
  Write-Output "列${c}=${v}"
}
for($r=2;$r -le 5;$r++){
  Write-Output "--- 行${r} ---"
  for($c=1;$c -le $cols;$c++){
    $v=$ws.Cells.Item($r,$c).Value2
    Write-Output "  列${c}=${v}"
  }
}
$wb.Close($false)
$excel.Quit()
