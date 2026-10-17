using static TownshipMonitor.MonitorDisplayText;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace TownshipMonitor;

internal sealed class MonitorForm : Form
{
    private readonly TextBox source = new() { Dock = DockStyle.Fill };
    private readonly TextBox inventory = new() { Dock = DockStyle.Fill };
    private readonly Button connect = new() { Text = "연결", AutoSize = true };
    private readonly Button start = new() { Text = "시작", AutoSize = true, Enabled = false };
    private readonly Button pause = new() { Text = "일시중지", AutoSize = true, Enabled = false };
    private readonly Button refresh = new() { Text = "상태 새로고침", AutoSize = true, Enabled = false };
    private readonly Button resolveMinigame = new() { Text = "미니게임 해결", AutoSize = true, Enabled = false };
    private bool resolvingMinigame;
    private readonly Button restart = new() { Text = "프로그램 재시작", AutoSize = true };
    private readonly CheckBox helicopterOnly = new() { Text = "헬리콥터만 납품", AutoSize = true, Enabled = false };
    private readonly ToolTip deliveryTip = new();
    private readonly CheckBox ocr = new() { Text = "요청된 OCR 처리", AutoSize = true };
    private readonly ComboBox language = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 85 };
    private readonly Label status = new() { Text = "저장된 상태에 연결 중…", Dock = DockStyle.Fill, AutoEllipsis = true, TextAlign = ContentAlignment.MiddleLeft };
    private readonly Label deliveryCount = new() { Text = "오늘 납품 완료: 0건 · 어제: 기록 없음", Dock = DockStyle.Fill, AutoSize = true, TextAlign = ContentAlignment.MiddleRight };
    private readonly RequiredGoodsPanel requiredPanel;
    private readonly TabControl tabs = new() { Dock = DockStyle.Fill };
    private readonly List<Button> folderButtons = [];
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    private readonly string root, settingsFile;
    private static readonly string Incarnation = Guid.NewGuid().ToString("D");
    private readonly bool smoke;
    private BridgeClient? bridge;
    private MonitorControl? control;
    private bool connected, allowClose, workerBusy, applyingSnapshot;
    private readonly MonitorUiOperations operations = new();
    private bool refreshing => operations.Has(UiOperation.Refresh);
    private bool closing => operations.Has(UiOperation.Close);
    private bool restarting => operations.Has(UiOperation.Restart);
    private bool connecting => operations.Has(UiOperation.Connect);
    private bool pausing => operations.Has(UiOperation.Pause);
    private bool changingDeliveryOptions => operations.Has(UiOperation.Options);
    private int viewGeneration => operations.Generation;
    private JsonElement snapshot;

    public MonitorForm(string root, string? sourcePath, string? inventoryPath, bool smoke)
    {
        this.root = root; this.smoke = smoke;
        requiredPanel = new RequiredGoodsPanel(root);
        Text = "Township Monitor"; Width = 720; Height = 540; MinimumSize = new Size(480, 360); StartPosition = FormStartPosition.CenterScreen;
        if (smoke) { StartPosition = FormStartPosition.Manual; Location = new Point(-3000, -3000); ShowInTaskbar = false; }
        Font = new Font("맑은 고딕", 9F);
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TownshipMonitor");
        settingsFile = Path.Combine(folder, "settings-" + Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(root))).Substring(0, 12) + ".json");
        source.Text = sourcePath ?? Path.Combine(root, "runtime", "mumu-autonomous-transport"); inventory.Text = inventoryPath ?? "";
        if (!smoke && File.Exists(settingsFile))
            try
            {
                using var d = JsonDocument.Parse(File.ReadAllText(settingsFile));
                if (sourcePath is null) { source.Text = TextOf(d.RootElement, "sourceRoot"); inventory.Text = TextOf(d.RootElement, "inventoryRoot"); }
                if (d.RootElement.TryGetProperty("windowX", out var x) && x.TryGetInt32(out var left)
                    && d.RootElement.TryGetProperty("windowY", out var y) && y.TryGetInt32(out var top))
                {
                    var area = Screen.FromPoint(new Point(left, top)).WorkingArea;
                    StartPosition = FormStartPosition.Manual;
                    Location = new Point(Math.Clamp(left, area.Left, Math.Max(area.Left, area.Right - Width)),
                        Math.Clamp(top, area.Top, Math.Max(area.Top, area.Bottom - Height)));
                }
            }
            catch { }
        language.Items.AddRange(["en-US", "ko-KR"]); language.SelectedIndex = 0;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(8) };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Margin = Padding.Empty };
        buttons.Controls.AddRange([start, pause, restart, resolveMinigame]);
        var summary = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = Padding.Empty };
        summary.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        summary.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        summary.Controls.Add(status, 0, 0); summary.Controls.Add(deliveryCount, 1, 0);
        layout.Controls.Add(buttons, 0, 0); layout.Controls.Add(summary, 0, 1); layout.Controls.Add(tabs, 0, 2); Controls.Add(layout);
        AddTab("필요 물품", requiredPanel);
        connect.Click += async (_, _) => await Connect(); start.Click += async (_, _) => await Start(); pause.Click += async (_, _) => await Pause();
        refresh.Click += async (_, _) => await RefreshState(); timer.Tick += async (_, _) => await RefreshState();
        restart.Click += async (_, _) => await Restart();
        resolveMinigame.Click += async (_, _) => await ResolveMinigame();
        helicopterOnly.CheckedChanged += async (_, _) => { if (!applyingSnapshot) await ChangeDeliveryOptions(); };
        deliveryTip.SetToolTip(helicopterOnly, "일시중지 후 변경할 수 있습니다. 체크하면 비행기·열차 주문, 재고 예약, 필요 물품 구매를 제외합니다. 세션별로 저장됩니다.");
        Shown += async (_, _) =>
        {
            if (smoke) return;
            control = new MonitorControl(RequestLocalRestart,
                () => PostControl(Close), message => PostControl(() => AddLog(message)));
            await Connect();
            if (connected && start.Enabled) await Start(automatic: true);
        };
        FormClosing += OnClosing;
    }
    private void AddTab(string title, Control control) { var tab = new TabPage(title); tab.Controls.Add(control); tabs.TabPages.Add(tab); }
    private async Task Connect()
    {
        if (workerBusy || closing || restarting || connecting || changingDeliveryOptions) return;
        BeginOperation(UiOperation.Connect);
        try
        {
            bridge ??= new BridgeClient(root);
            var value = await bridge.SendAsync("connect", new { sourceRoot = source.Text, inventoryRoot = string.IsNullOrWhiteSpace(inventory.Text) ? null : inventory.Text, startupIncarnation = Incarnation });
            connected = true; ApplySnapshot(value); SaveSettings(); timer.Start();
        }
        catch (Exception ex) { connected = false; ShowError(ex); }
        finally { EndOperation(UiOperation.Connect); }
    }
    private async Task Start(bool automatic = false)
    {
        if (bridge is null || !connected || workerBusy || closing || restarting || changingDeliveryOptions) return;
        BeginOperation(UiOperation.Start); workerBusy = true; status.Text = "관측·납품 프로그램 시작 중…";
        try { await bridge.SendAsync("start", new { ocr = ocr.Checked, language = language.Text, automatic }); await RefreshState(); }
        catch (Exception ex) { ShowError(ex); workerBusy = false; }
        finally { EndOperation(UiOperation.Start); await RefreshState(); }
    }
    private async Task ChangeDeliveryOptions()
    {
        if (bridge is null || !connected || changingDeliveryOptions) return;
        BeginOperation(UiOperation.Options); operations.Invalidate();
        try
        {
            var value = await bridge.SendAsync("set_delivery_options", new { helicopterOnly = helicopterOnly.Checked });
            ApplySnapshot(value);
        }
        catch (Exception ex)
        {
            applyingSnapshot = true;
            helicopterOnly.Checked = Bool(Prop(snapshot,"deliveryOptions"),"helicopterOnly");
            applyingSnapshot = false;
            ShowError(ex);
        }
        finally { EndOperation(UiOperation.Options); operations.Invalidate(); await RefreshState(); }
    }
    private async Task ResolveMinigame()
    {
        if (bridge is null || !connected || resolvingMinigame || closing || restarting || !resolveMinigame.Enabled) return;
        resolvingMinigame = true; operations.Invalidate(); ApplyAvailability();
        try { await bridge.SendAsync("resolve_minigame"); }
        catch (Exception ex) { if (!closing && !restarting) ShowError(ex); }
        finally { resolvingMinigame = false; operations.Invalidate(); ApplyAvailability(); await RefreshState(); }
    }
    private async Task Pause()
    {
        if (bridge is null || !connected || closing || restarting || pausing) return;
        BeginOperation(UiOperation.Pause); operations.Invalidate();
        status.Text = "일시중지 요청 중…";
        try { var result = await bridge.SendAsync("pause"); operations.Invalidate();
            status.Text = Bool(result,"workersStopping") ? "일시중지 접수 · 진행 중인 작업 종료 확인 중…" : "일시중지 완료";
        } catch (Exception ex) { ShowError(ex); }
        finally { EndOperation(UiOperation.Pause); }
        await RefreshState();
    }
    private async Task RefreshState()
    {
        if (bridge is null || !connected || refreshing || closing || restarting) return;
        if (pausing || changingDeliveryOptions) return;
        BeginOperation(UiOperation.Refresh); var generation = viewGeneration;
        try { var value = await bridge.SendAsync("status", new { view = "required_goods" }); if (!restarting && !closing && !pausing && generation == viewGeneration) ApplySnapshot(value); }
        catch (Exception ex) { if (!restarting && !closing && !pausing && generation == viewGeneration) ShowError(ex); }
        finally { EndOperation(UiOperation.Refresh); }
    }
    private void PostControl(Action action)
    {
        if (!IsDisposed && IsHandleCreated) try { BeginInvoke(action); } catch (InvalidOperationException) { }
    }
    private Task<RestartResult> RequestLocalRestart()
    {
        var completion = new TaskCompletionSource<RestartResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (IsDisposed || !IsHandleCreated) return Task.FromResult(new RestartResult(false,"rejected","MONITOR_CLOSING"));
        try { BeginInvoke(async () =>
        {
            try { completion.TrySetResult(await Restart(deferClose:true)); }
            catch (Exception ex) { completion.TrySetResult(new RestartResult(false,"uncertain",ex.Message)); }
        }); }
        catch (InvalidOperationException) { completion.TrySetResult(new RestartResult(false,"rejected","MONITOR_CLOSING")); }
        return completion.Task;
    }
    private async Task<RestartResult> Restart(bool deferClose = false)
    {
        if (restarting || closing || connecting || pausing || changingDeliveryOptions) return new(false,"rejected","MONITOR_BUSY");
        BeginOperation(UiOperation.Restart); timer.Stop();
        status.Text = "소유한 관측·연결 프로세스 종료 확인 중…";
        try
        {
            if (bridge is not null) await bridge.ShutdownAsync(preserveStops:true);
            SaveSettings();
            var executable = Environment.ProcessPath ?? throw new IOException("MONITOR_EXECUTABLE_REQUIRED");
            using var current = Process.GetCurrentProcess();
            using var replacement = Process.Start(MonitorRestart.Replacement(executable,root,source.Text,inventory.Text,
                current.Id,current.StartTime.ToUniversalTime().Ticks)) ?? throw new IOException("MONITOR_RESTART_LAUNCH_FAILED");
            var result = new RestartResult(true,"replacement_started",ReplacementPid:replacement.Id,
                ReplacementStarted:replacement.StartTime.ToUniversalTime().Ticks.ToString());
            bridge?.Dispose(); bridge = null; allowClose = true;
            if (!deferClose) Close();
            return result;
        }
        catch (Exception ex)
        {
            connected = bridge?.CanSend == true; ShowError(ex); AddLog("프로그램 재시작을 취소했습니다. 종료가 불확실한 프로세스나 다른 소유자의 잠금은 건드리지 않습니다.");
            return new(false,connected ? "rejected" : "uncertain",ex.Message);
        }
        finally { if (!allowClose) { EndOperation(UiOperation.Restart); if (connected) { await RefreshState(); timer.Start(); } } }
    }
    private void SaveSettings()
    {
        if (smoke) return;
        var position = WindowState == FormWindowState.Normal ? Location : RestoreBounds.Location;
        try { Directory.CreateDirectory(Path.GetDirectoryName(settingsFile)!); File.WriteAllText(settingsFile, JsonSerializer.Serialize(new { sourceRoot = source.Text, inventoryRoot = inventory.Text, windowX = position.X, windowY = position.Y })); }
        catch (Exception ex) { AddLog("설정 저장: " + ex.Message); }
    }
    private void BeginOperation(UiOperation operation) { operations.Begin(operation); ApplyAvailability(); }
    private void EndOperation(UiOperation operation) { operations.End(operation); ApplyAvailability(); }
    private void ApplyAvailability()
    {
        var automation = Prop(snapshot,"automation");
        var available = MonitorAvailability.Compute(operations,connected || smoke,workerBusy,Bool(automation,"producerAlive"),
            Bool(Prop(automation,"delivery"),"running"),TextOf(Prop(snapshot,"session"),"provider") is "google_play_windows" or "android_adb",
            Prop(automation,"input").ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined));
        connect.Enabled=available.Connect && (bridge is null || bridge.CanSend); start.Enabled=available.Start; pause.Enabled=available.Pause;
        refresh.Enabled=available.Refresh; restart.Enabled=available.Restart;
        resolveMinigame.Enabled=available.Refresh && !pausing && !resolvingMinigame &&
            TextOf(automation,"status") == "minigame_requesting" && !Bool(Prop(Prop(automation,"delivery"),"minigame"),"resolving");
        source.ReadOnly=!available.EditPaths; inventory.ReadOnly=!available.EditPaths;
        foreach (var button in folderButtons) button.Enabled=available.EditPaths;
        ocr.Enabled=available.EditPaths; language.Enabled=available.EditPaths; helicopterOnly.Enabled=available.DeliveryOptions;
    }
    internal void ApplySnapshot(JsonElement value)
    {
        if (restarting || closing) return;
        snapshot = value.Clone(); var automation = Prop(snapshot, "automation"); var worker = Prop(automation, "worker"); var scene = Prop(snapshot, "scene");
        var delivery = Prop(automation,"delivery");
        if (automation.TryGetProperty("completedDeliveries", out var count) && count.TryGetInt64(out var total) && total >= 0)
        {
            var yesterday = automation.TryGetProperty("yesterdayCompletedDeliveries", out var previous)
                && previous.ValueKind == JsonValueKind.Number && previous.TryGetInt64(out var previousTotal) && previousTotal >= 0
                ? $"{previousTotal:N0}건" : "기록 없음";
            deliveryCount.Text = $"오늘 납품 완료: {total:N0}건 · 어제: {yesterday}";
        }
        workerBusy = Bool(worker, "running") || Bool(worker, "starting");
        ApplyAvailability();
        applyingSnapshot = true;
        helicopterOnly.Checked = Bool(Prop(snapshot,"deliveryOptions"),"helicopterOnly");
        applyingSnapshot = false;
        status.Text = TextOf(automation,"status") == "minigame_requesting" ?
            (Bool(Prop(delivery,"minigame"),"resolving") ? "minigame_requesting · 1초 뒤 운영 재개" : "minigame_requesting · 미니게임 해결 대기") :
            TextOf(automation,"status") == "paused" ? "일시정지" :
            workerBusy || Bool(automation,"producerAlive") ? "실행 중" : "대기";
        var error = TextOf(worker,"error");
        if (error.Length == 0 && TextOf(delivery,"phase") == "hold") error = TextOf(delivery,"reason");
        if (error.Length > 0 && error != "SESSION_STOPPED") status.Text += " · " + error;
        requiredPanel.UpdateSnapshot(Prop(snapshot,"requiredGoods"));
    }
    private void AddLog(string message) { status.Text = message; }
    private void ShowError(Exception ex) { status.Text="오류: "+ex.Message; AddLog(ex.Message); }
    private async void OnClosing(object? sender, FormClosingEventArgs args)
    {
        if (allowClose || smoke) return; args.Cancel=true; if (closing || restarting) return; BeginOperation(UiOperation.Close); timer.Stop(); SaveSettings();
        try { if (bridge is not null) await bridge.ShutdownAsync(); } catch (Exception ex) { AddLog(ex.Message); }
        bridge?.Dispose(); allowClose=true; Close();
    }
    internal object CheckLayout() => new { tabs=tabs.TabPages.Count, requiredRows=requiredPanel.ItemCount,
        deliveryCountText=deliveryCount.Text,deliveryCountVisible=deliveryCount.Visible,
        deliveryCountFits=deliveryCount.Right<=deliveryCount.Parent!.ClientSize.Width,
        requiredTab=tabs.TabPages.Cast<TabPage>().Any(t=>t.Text=="필요 물품"), imageLoaded=false,
        startVisible=start.Visible,pauseVisible=pause.Visible,restartVisible=restart.Visible,
        minigameVisible=resolveMinigame.Visible,minigameEnabled=resolveMinigame.Enabled,
        minigameFits=resolveMinigame.Right<=resolveMinigame.Parent!.ClientSize.Width,
        restartFits=restart.Right<=restart.Parent!.ClientSize.Width&&restart.Bottom<=restart.Parent.ClientSize.Height,
        sourceVisible=source.Parent is not null && source.Visible,clientWidth=ClientSize.Width,clientHeight=ClientSize.Height };
    internal async Task CheckBridgeAsync(string sourceRoot)
    {
        using var client = new BridgeClient(root);
        var initial = await client.SendAsync("connect",new { sourceRoot });
        var current = await client.SendAsync("status");
        if (TextOf(initial,"revision") != TextOf(current,"revision")) throw new IOException("읽기 전용 연결 중 revision 변경");
        await client.ShutdownAsync();
    }
    internal void SelectValidationTab(int index) { tabs.SelectedIndex=index; PerformLayout(); }
    protected override void Dispose(bool disposing) { if (disposing) { control?.Dispose(); deliveryTip.Dispose(); timer.Dispose(); } base.Dispose(disposing); }
}
