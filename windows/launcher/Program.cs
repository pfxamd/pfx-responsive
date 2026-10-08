using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace PFxResponsive;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new LocalLauncher());
    }
}

internal sealed class LocalLauncher : Form
{
    private const string Url = "http://127.0.0.1:4188/";
    private readonly Label state = new() { Text = "Starting local workspace…", Left = 23, Top = 62, Width = 380, Height = 45 };
    private readonly Button open = new() { Text = "Open workspace", Left = 23, Top = 125, Width = 166, Height = 37, Enabled = false };
    private readonly Button quit = new() { Text = "Exit", Left = 201, Top = 125, Width = 90, Height = 37 };
    private readonly NotifyIcon tray;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private readonly CancellationTokenSource stopping = new();
    private Process? core;
    private Process? app;
    private bool ready;
    private bool exiting;

    public LocalLauncher()
    {
        Text = "PFx Responsive";
        ClientSize = new Size(420, 188);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(20, 22, 29);
        ForeColor = Color.FromArgb(238, 239, 243);
        Font = new Font("Segoe UI", 10F);
        Controls.Add(new Label { Text = "PFx Responsive", Left = 23, Top = 19, Width = 320,
            Height = 35, Font = new Font("Segoe UI Semibold", 17F, FontStyle.Bold) });
        Controls.Add(state);
        Controls.Add(open);
        Controls.Add(quit);
        open.Click += (_, _) => OpenBrowser();
        quit.Click += (_, _) => ExitLauncher();
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "PFx Responsive", Visible = true };
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open workspace", null, (_, _) => OpenBrowser());
        menu.Items.Add("Exit PFx Responsive", null, (_, _) => ExitLauncher());
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += (_, _) => OpenBrowser();
        Shown += async (_, _) => await StartAsync();
        FormClosing += (_, e) => {
            if (!exiting && ready) { e.Cancel = true; Hide(); return; }
            stopping.Cancel();
            KillChildren();
            tray.Visible = false;
            tray.Dispose();
            http.Dispose();
        };
    }

    private async Task StartAsync()
    {
        try
        {
            var root = AppContext.BaseDirectory;
            var node = Path.Combine(root, "node.exe");
            var corePath = Path.Combine(root, "core", "src", "server.js");
            var appPath = Path.Combine(root, "app", "src", "local-server.js");
            if (!File.Exists(node) || !File.Exists(corePath) || !File.Exists(appPath))
                throw new IOException("Incomplete portable folder. Keep all bundled files together.");
            // Do not attach this launcher to an unrelated service that already
            // occupies the loopback ports. The random token is for THIS launch.
            if (await IsPortTakenAsync(4177) || await IsPortTakenAsync(4188))
                throw new IOException("Port 4177 or 4188 is already occupied. Close the other instance first.");
            var secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            core = StartNode(node, "core", "src/server.js", secret, root);
            await WaitForHealthAsync("http://127.0.0.1:4177/health", core, stopping.Token);
            app = StartNode(node, "app", "src/local-server.js", secret, root);
            await WaitForHealthAsync(Url, app, stopping.Token);
            ready = true;
            state.Text = "Workspace is running on this computer.";
            open.Enabled = true;
            if (Environment.GetEnvironmentVariable("PFX_LAUNCHER_NO_BROWSER") != "1") {
                OpenBrowser();
                Hide();
            }
        }
        catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
        catch (Exception error)
        {
            KillChildren();
            state.Text = "Unable to start. See the error below.";
            MessageBox.Show(this, error.Message, "PFx Responsive — startup failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static Process StartNode(string node, string folder, string script, string secret, string root)
    {
        var psi = new ProcessStartInfo(node) {
            WorkingDirectory = Path.Combine(root, folder),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        psi.ArgumentList.Add(script);
        psi.Environment["PFX_PREVIEW_TOKEN"] = secret;
        psi.Environment["PFX_RESPONSIVE_CORE_TOKEN"] = secret;
        psi.Environment["PFX_LOCAL_WINDOWS"] = "1";
        psi.Environment["PLAYWRIGHT_BROWSERS_PATH"] = "0";
        psi.Environment.Remove("PFX_TENANTS_JSON");
        psi.Environment.Remove("PFX_REQUIRE_OS_QUOTAS");
        psi.Environment.Remove("PFX_CHROMIUM_PATH");
        psi.Environment.Remove("PFX_ALLOWED_ORIGIN");
        psi.Environment.Remove("NODE_OPTIONS");
        psi.Environment["HOST"] = "127.0.0.1";
        psi.Environment["PORT"] = "4177";
        psi.Environment["PFX_RESPONSIVE_PORT"] = "4188";
        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, _) => { };
        process.ErrorDataReceived += (_, _) => { };
        if (!process.Start()) throw new IOException($"Unable to start {folder} service.");
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }

    private static async Task<bool> IsPortTakenAsync(int port)
    {
        using var socket = new TcpClient();
        try {
            using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
            await socket.ConnectAsync(IPAddress.Loopback, port, timeout.Token);
            return true;
        }
        catch (SocketException) { return false; }
        catch (OperationCanceledException) { return false; }
    }

    private async Task WaitForHealthAsync(string url, Process process, CancellationToken stop)
    {
        for (var i = 0; i < 80; i++)
        {
            stop.ThrowIfCancellationRequested();
            if (process.HasExited) throw new IOException($"A local service exited early (code {process.ExitCode}).");
            try {
                using var response = await http.GetAsync(url, stop);
                if (response.IsSuccessStatusCode) return;
            } catch (HttpRequestException) { } catch (TaskCanceledException) when (!stop.IsCancellationRequested) { }
            await Task.Delay(750, stop);
        }
        throw new TimeoutException("Local service did not become ready in time.");
    }

    private static void OpenBrowser()
    {
        const string url = Url;
        string[] firefoxPaths = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Mozilla Firefox", "firefox.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Mozilla Firefox", "firefox.exe")
        };
        try
        {
            var firefox = firefoxPaths.FirstOrDefault(File.Exists);
            if (firefox != null) {
                var psi = new ProcessStartInfo(firefox) { UseShellExecute = true };
                psi.ArgumentList.Add("--new-window");
                psi.ArgumentList.Add(url);
                Process.Start(psi);
            } else Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception error) { MessageBox.Show(error.Message, "Unable to open browser"); }
    }

    private void ExitLauncher()
    {
        exiting = true;
        Close();
    }

    private void KillChildren()
    {
        foreach (var process in new[] {app, core})
        {
            try { if (process != null && !process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
            process?.Dispose();
        }
        app = core = null;
    }
}
