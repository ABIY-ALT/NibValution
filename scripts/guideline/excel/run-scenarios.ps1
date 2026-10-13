<#
  Runs valuation scenarios through Microsoft Excel itself.

    powershell -File scripts/guideline/excel/run-scenarios.ps1 -Workbook <template.xlsm> `
      -Scenarios <scenarios.json> -Out <results.json>

  For each scenario: opens the workbook read-only, clears the cells listed in
  "clear", types the "writes" into the input cells, recalculates in full, and
  records every non-empty value in the "reads" ranges as "Sheet!A1". The
  workbook is closed without saving; nothing is written back to it.

  Built by scripts/guideline/excel/scenarios.mts, which also compares the
  results with the system's engine. Needs Windows and Excel; the template's
  macros (PtInPoly) must be allowed to run, as they are under automation.
#>
param(
  [Parameter(Mandatory = $true)][string]$Workbook,
  [Parameter(Mandatory = $true)][string]$Scenarios,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'

function ColumnName([int]$n) {
  $name = ''
  while ($n -gt 0) {
    $r = ($n - 1) % 26
    $name = [char](65 + $r) + $name
    $n = [math]::Floor(($n - 1) / 26)
  }
  return $name
}

$spec = Get-Content -Raw -Encoding UTF8 -Path $Scenarios | ConvertFrom-Json
$results = [ordered]@{}

$before = @(Get-Process EXCEL -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$excel = New-Object -ComObject Excel.Application
$mine = Get-Process EXCEL | Where-Object { $before -notcontains $_.Id } | Select-Object -First 1
if ($mine) { Set-Content -Path "$Out.pid" -Value $mine.Id }
try {
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.EnableEvents = $false
  foreach ($scenario in $spec.scenarios) {
    $started = Get-Date
    $values = [ordered]@{}
    $problem = $null
    $wb = $excel.Workbooks.Open((Resolve-Path $Workbook).Path, 0, $true)
    try {
      $excel.Calculation = -4135 # manual while typing
      foreach ($cell in $scenario.clear) {
        try { $wb.Worksheets.Item($cell.sheet).Range($cell.ref).MergeArea.ClearContents() | Out-Null }
        catch { throw "clearing $($cell.sheet)!$($cell.ref): $($_.Exception.Message)" }
      }
      foreach ($write in $scenario.writes) {
        try {
          $target = $wb.Worksheets.Item($write.sheet).Range($write.ref)
          if ($null -eq $write.value) { $target.MergeArea.ClearContents() | Out-Null }
          elseif ($write.value -is [string]) { $target.Value2 = [string]$write.value }
          else { $target.Value2 = [double]$write.value }
        } catch { throw "writing $($write.sheet)!$($write.ref): $($_.Exception.Message)" }
      }
      $excel.CalculateFull()
      foreach ($read in $scenario.reads) {
        $range = $wb.Worksheets.Item($read.sheet).Range($read.range)
        $grid = $range.Value2
        $row0 = $range.Row
        $col0 = $range.Column
        $rows = $range.Rows.Count
        $cols = $range.Columns.Count
        for ($i = 1; $i -le $rows; $i++) {
          for ($j = 1; $j -le $cols; $j++) {
            $v = if ($rows -eq 1 -and $cols -eq 1) { $grid } else { $grid[$i, $j] }
            if ($null -eq $v -or ($v -is [string] -and $v -eq '')) { continue }
            # Excel errors come back as negative integers (e.g. -2146826281 for #DIV/0!).
            if ($v -is [int] -and $v -lt -2146820000) { $v = '#ERROR' }
            $values["$($read.sheet)!$(ColumnName ($col0 + $j - 1))$($row0 + $i - 1)"] = $v
          }
        }
      }
    } catch {
      $problem = $_.Exception.Message
    } finally {
      $wb.Close($false)
    }
    $results[$scenario.name] = [ordered]@{ error = $problem; values = $values }
    "{0,-34} {1,5:N1} s {2}" -f $scenario.name, ((Get-Date) - $started).TotalSeconds, ($(if ($problem) { "ERROR $problem" } else { "$($values.Count) cells" }))
  }
} finally {
  $excel.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
}
$results | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path $Out -Encoding utf8
"wrote $Out"
