Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:running = $false

function Append-Log {
  param([System.Windows.Forms.TextBox]$LogBox, [string]$Message)
  $timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $LogBox.AppendText("[$timestamp] $Message`r`n")
}

function Invoke-Step {
  param(
    [System.Windows.Forms.TextBox]$LogBox,
    [string]$Label,
    [string]$Command
  )

  Append-Log $LogBox "$Label -> $Command"

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = "/c $Command"
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $null = $proc.Start()

  while (-not $proc.HasExited) {
    while (-not $proc.StandardOutput.EndOfStream) {
      Append-Log $LogBox ($proc.StandardOutput.ReadLine())
    }
    while (-not $proc.StandardError.EndOfStream) {
      Append-Log $LogBox ($proc.StandardError.ReadLine())
    }
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.Application]::DoEvents()
  }

  while (-not $proc.StandardOutput.EndOfStream) {
    Append-Log $LogBox ($proc.StandardOutput.ReadLine())
  }
  while (-not $proc.StandardError.EndOfStream) {
    Append-Log $LogBox ($proc.StandardError.ReadLine())
  }

  if ($proc.ExitCode -ne 0) {
    throw "Step failed ($Label), exit code: $($proc.ExitCode)"
  }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'eBay Deal Finder - Local Setup Wizard'
$form.Size = New-Object System.Drawing.Size(960, 700)
$form.StartPosition = 'CenterScreen'

$title = New-Object System.Windows.Forms.Label
$title.Text = 'eBay Deal Finder - Local Wizard (no web app)'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 20)
$form.Controls.Add($title)

$runButton = New-Object System.Windows.Forms.Button
$runButton.Text = 'Run One-Click Setup'
$runButton.Size = New-Object System.Drawing.Size(180, 35)
$runButton.Location = New-Object System.Drawing.Point(20, 60)
$form.Controls.Add($runButton)

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Status: Idle'
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(220, 70)
$form.Controls.Add($status)

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Multiline = $true
$logBox.ScrollBars = 'Vertical'
$logBox.ReadOnly = $true
$logBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$logBox.Location = New-Object System.Drawing.Point(20, 110)
$logBox.Size = New-Object System.Drawing.Size(900, 520)
$form.Controls.Add($logBox)

Append-Log $logBox 'Wizard ready.'
Append-Log $logBox 'This is a local Windows GUI; no browser/web app required.'

$runButton.Add_Click({
  if ($script:running) { return }
  $script:running = $true
  $runButton.Enabled = $false
  $status.Text = 'Status: Running...'

  try {
    if (-not (Test-Path '.env') -and (Test-Path '.env.example')) {
      Copy-Item '.env.example' '.env' -Force
      Append-Log $logBox 'Created .env from .env.example'
    }

    Invoke-Step $logBox 'Step 1/5 Install dependencies' 'pnpm i'
    Invoke-Step $logBox 'Step 2/5 Database migrations' 'pnpm db:migrate'
    Invoke-Step $logBox 'Step 3/5 Prisma client generation' 'pnpm prisma:generate'
    Invoke-Step $logBox 'Step 4/5 Typecheck' 'pnpm typecheck'
    Invoke-Step $logBox 'Step 5/5 Initial scan cycle' 'pnpm hunt:run && pnpm scan:run'

    $status.Text = 'Status: Completed'
    Append-Log $logBox 'Setup completed successfully.'
    [System.Windows.Forms.MessageBox]::Show('Setup completed successfully.', 'eBay Deal Finder Wizard', 'OK', 'Information') | Out-Null
  }
  catch {
    $status.Text = 'Status: Failed'
    Append-Log $logBox "ERROR: $($_.Exception.Message)"
    [System.Windows.Forms.MessageBox]::Show("Setup failed: $($_.Exception.Message)", 'eBay Deal Finder Wizard', 'OK', 'Error') | Out-Null
  }
  finally {
    $runButton.Enabled = $true
    $script:running = $false
  }
})

[void]$form.ShowDialog()
