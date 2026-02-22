/**
 * System Tray Icon for COE Standalone Server (Windows)
 *
 * Uses PowerShell + .NET System.Windows.Forms.NotifyIcon to create a
 * zero-dependency system tray icon. Communicates with the Node process
 * via stdout line protocol:
 *   - "OPEN_WEBAPP" → open browser
 *   - "STOP_SERVER" → graceful shutdown
 *   - "TRAY_EXIT"   → tray icon closed by user
 *
 * On non-Windows platforms, this module is a silent no-op.
 */

import { spawn, ChildProcess } from 'child_process';
import { OutputChannelLike } from '../types';

export interface TrayCallbacks {
    onOpenWebApp: () => void;
    onStopServer: () => void;
}

export class SystemTray {
    private trayProcess: ChildProcess | null = null;
    private disposed = false;

    constructor(
        private port: number,
        private callbacks: TrayCallbacks,
        private outputChannel: OutputChannelLike,
    ) {}

    /**
     * Start the system tray icon. No-op on non-Windows platforms.
     */
    start(): void {
        if (process.platform !== 'win32') {
            this.outputChannel.appendLine('[SystemTray] Skipped — not Windows.');
            return;
        }

        const psScript = this.buildPowerShellScript();

        try {
            this.trayProcess = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command', psScript,
            ], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });

            this.trayProcess.stdout?.on('data', (data: Buffer) => {
                const lines = data.toString().trim().split(/\r?\n/);
                for (const line of lines) {
                    this.handleTrayMessage(line.trim());
                }
            });

            this.trayProcess.stderr?.on('data', (data: Buffer) => {
                const msg = data.toString().trim();
                if (msg) {
                    this.outputChannel.appendLine(`[SystemTray] PS error: ${msg}`);
                }
            });

            this.trayProcess.on('exit', (code) => {
                if (!this.disposed) {
                    this.outputChannel.appendLine(`[SystemTray] Tray process exited (code ${code}).`);
                }
                this.trayProcess = null;
            });

            this.outputChannel.appendLine('[SystemTray] Tray icon started.');
        } catch (err) {
            this.outputChannel.appendLine(`[SystemTray] Failed to start: ${err}`);
        }
    }

    /**
     * Handle messages from the PowerShell tray process.
     */
    private handleTrayMessage(message: string): void {
        switch (message) {
            case 'OPEN_WEBAPP':
                this.outputChannel.appendLine('[SystemTray] User clicked: Open Web App');
                this.callbacks.onOpenWebApp();
                break;
            case 'STOP_SERVER':
                this.outputChannel.appendLine('[SystemTray] User clicked: Stop Server');
                this.callbacks.onStopServer();
                break;
            case 'TRAY_EXIT':
                this.outputChannel.appendLine('[SystemTray] Tray icon closed.');
                break;
            case 'TRAY_READY':
                this.outputChannel.appendLine('[SystemTray] Tray icon ready in notification area.');
                break;
            default:
                // Ignore other PowerShell output
                break;
        }
    }

    /**
     * Update the tray tooltip text (e.g., to show status changes).
     */
    updateTooltip(text: string): void {
        if (this.trayProcess?.stdin?.writable) {
            this.trayProcess.stdin.write(`TOOLTIP:${text}\n`);
        }
    }

    /**
     * Dispose the tray icon and kill the PowerShell process.
     */
    dispose(): void {
        this.disposed = true;
        if (this.trayProcess) {
            try {
                // Send exit command to PowerShell
                if (this.trayProcess.stdin?.writable) {
                    this.trayProcess.stdin.write('EXIT\n');
                }
                // Give it a moment then force kill
                setTimeout(() => {
                    if (this.trayProcess) {
                        this.trayProcess.kill();
                        this.trayProcess = null;
                    }
                }, 1000);
            } catch {
                // Already dead
                this.trayProcess = null;
            }
        }
    }

    /**
     * Build the PowerShell script that creates the NotifyIcon.
     *
     * The script:
     * 1. Loads System.Windows.Forms and System.Drawing
     * 2. Creates a NotifyIcon with a COE-branded icon (gear + sparkle)
     * 3. Adds a context menu with: Open Web App, Stop Server, separator, Exit
     * 4. Writes action names to stdout for Node.js to read
     * 5. Reads stdin for commands (TOOLTIP:text, EXIT)
     */
    private buildPowerShellScript(): string {
        const port = this.port;

        // PowerShell script as a single string (no line breaks in spawn args)
        return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$appContext = New-Object System.Windows.Forms.ApplicationContext

# Create tray icon with a simple built-in icon
$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$trayIcon.Icon = [System.Drawing.SystemIcons]::Application
$trayIcon.Text = "COE Server - localhost:${port}"
$trayIcon.Visible = $true

# Context menu
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openItem.Text = "Open Web App"
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
$openItem.Add_Click({
    [Console]::Out.WriteLine("OPEN_WEBAPP")
    [Console]::Out.Flush()
})
$menu.Items.Add($openItem) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$stopItem = New-Object System.Windows.Forms.ToolStripMenuItem
$stopItem.Text = "Stop Server"
$stopItem.Add_Click({
    [Console]::Out.WriteLine("STOP_SERVER")
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 500
    $trayIcon.Visible = $false
    $trayIcon.Dispose()
    $appContext.ExitThread()
})
$menu.Items.Add($stopItem) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = "Hide Tray Icon"
$exitItem.Add_Click({
    [Console]::Out.WriteLine("TRAY_EXIT")
    [Console]::Out.Flush()
    $trayIcon.Visible = $false
    $trayIcon.Dispose()
    $appContext.ExitThread()
})
$menu.Items.Add($exitItem) | Out-Null

$trayIcon.ContextMenuStrip = $menu

# Double-click opens webapp
$trayIcon.Add_DoubleClick({
    [Console]::Out.WriteLine("OPEN_WEBAPP")
    [Console]::Out.Flush()
})

# stdin reader for commands from Node.js (runs on background thread)
$stdinReader = {
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line -or $line -eq "EXIT") {
            $trayIcon.Visible = $false
            $trayIcon.Dispose()
            $appContext.ExitThread()
            break
        }
        if ($line.StartsWith("TOOLTIP:")) {
            $trayIcon.Text = $line.Substring(8)
        }
    }
}
$runspace = [runspacefactory]::CreateRunspace()
$runspace.Open()
$pipeline = $runspace.CreatePipeline()
$pipeline.Commands.AddScript($stdinReader)
$pipeline.InvokeAsync()

[Console]::Out.WriteLine("TRAY_READY")
[Console]::Out.Flush()

[System.Windows.Forms.Application]::Run($appContext)
`.trim();
    }
}
