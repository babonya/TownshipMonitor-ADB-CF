using System.Text.Json;
using static TownshipMonitor.MonitorDisplayText;
namespace TownshipMonitor;
internal sealed record DisplayRows(string ChangeKey,IReadOnlyList<string[]> Values);
internal sealed record MonitorPresentation(string Status,string FrameCaption,string InventoryCaption,JsonElement Frame,
    IReadOnlyList<string[]> StateRows,DisplayRows Inventory,DisplayRows Orders,DisplayRows Detections,DisplayRows Actions)
{
    private static string Key(JsonElement value)=>value.ValueKind==JsonValueKind.Undefined?"":value.GetRawText();
    internal static string DiagnosticKey(JsonElement snapshot) { return TextOf(snapshot,"revision") + Prop(snapshot,"automation").ToString() + Prop(snapshot,"matching").ToString() + Prop(snapshot,"inventory").ToString() + Prop(snapshot,"orders").ToString() + Prop(snapshot,"requiredGoods").ToString() + Bool(Prop(snapshot,"frame"),"fresh"); }
    internal static MonitorPresentation Build(JsonElement snapshot)
    {
        var automation=Prop(snapshot,"automation");var worker=Prop(automation,"worker");var scene=Prop(snapshot,"scene");
        var delivery=Prop(automation,"delivery");var producer=Bool(automation,"producerAlive");
        var observationActive=producer && Bool(worker,"running") && !Bool(automation,"stopCapture") && !Bool(automation,"stopReader");
        List<string[]> stateRows=[],inventoryRows=[],orderRows=[],detectionRows=[],actionRows=[];
        var statusCaption = $"관측: {Translate(TextOf(automation, "status"))} / 촬영기: {(producer ? "실행 중" : "종료")} / 장부 장면: {TextOf(scene, "kind")}  | 일반 촬영 3초 · 클릭 후 1초 대기";
        if (!string.IsNullOrEmpty(TextOf(worker, "error"))) statusCaption += " / 오류: " + TextOf(worker, "error");
        statusCaption += (Bool(Prop(snapshot,"deliveryOptions"),"helicopterOnly") ? " · 헬리콥터만 납품" : " · 전체 운송 납품");
        var operation=Prop(snapshot,"operationStatus");
        var issues=Items(operation,"issues").ToArray();
        statusCaption += "\r\n납품: " + Translate(TextOf(delivery,"phase"));
        if (issues.Length>0) statusCaption += " · " + string.Join(" / ",issues.Select(i=>OperationIssue(TextOf(i,"code")).Label).Distinct());
        statusCaption += " · 준비된 주문 " + Items(operation,"readyOrders").Count() + "건 · 보류 주문 " + Items(operation,"heldOrders").Count() + "건";
        foreach (var issue in issues)
        {
            var explanation=OperationIssue(TextOf(issue,"code"));
            var affected=string.Join(", ",Items(issue,"orderIds").Select(x=>x.ToString()).Distinct());
            stateRows.Add([explanation.Label, explanation.Resume+(affected.Length>0?" · 영향 주문: "+affected:"")]);
            foreach (var action in Items(issue,"actions")) stateRows.Add(["입력 증거",TextOf(action,"id")+" · 원본 "+TextOf(action,"sourceFrameId")+" · 결과 "+TextOf(action,"resultFrameId")]);
        }
        var productEvidence=Prop(operation,"productEvidence");
        if (productEvidence.ValueKind==JsonValueKind.Object) stateRows.Add(["상품 등록 증거",TextOf(productEvidence,"id")+" · 수집 "+TextOf(productEvidence,"status")]);
        var schedule = Prop(delivery,"observationSchedule");
        if (producer && schedule.ValueKind == JsonValueKind.Object)
            statusCaption += " · 대기 촬영 " + TextOf(schedule,"intervalMs") + "ms · 다음 관측 " + LocalTime(TextOf(schedule,"nextObservationAt"));
        var reconciliation = Prop(delivery,"reconciliation");
        if (reconciliation.ValueKind == JsonValueKind.Object)
            statusCaption += " · 완료 기록 정리 " + TextOf(reconciliation,"completedRounds") + "건 · 인식 예외 보존 " + TextOf(reconciliation,"recognitionOnlyRounds") + "건";
        var refreshRequest = Prop(snapshot, "observationRefresh");
        if (refreshRequest.ValueKind == JsonValueKind.Object)
            statusCaption += "\r\n정보 갱신: " + Translate(TextOf(refreshRequest, "status")) + " · 남은 확인: " +
                string.Join(", ", Items(refreshRequest, "pendingSections").Select(x => SectionName(x.GetString() ?? ""))) + " " + TextOf(refreshRequest, "error");
        var frame = Prop(snapshot, "frame");
        var frameCaption = frame.ValueKind == JsonValueKind.Object ? $"{TextOf(frame, "id")}\r\n촬영: {LocalTime(TextOf(frame, "observedAt"))}  ({TextOf(frame, "ageMs")}ms 전) · {(Bool(frame, "fresh") ? "최근 원본" : "과거 원본")}" : "아직 촬영된 원본이 없습니다.";
        foreach (var (label, content) in new[] {
            ("세션", TextOf(Prop(snapshot,"session"),"id")), ("장부 revision", TextOf(snapshot,"revision")),
            ("게임 전면 상태", "현재 상태는 미확인"), ("마지막 전면 확인", LocalTime(TextOf(Prop(snapshot,"game"),"lastVerifiedAt"))),
            ("자동 관측", Translate(TextOf(automation,"status"))), ("관측 프로세스", Translate(TextOf(worker,"phase"))),
            ("납품 상태", Translate(TextOf(delivery,"phase"))), ("납품 보류", TextOf(delivery,"reason")=="ANDROID_PROFILE_REQUIRED" ? "휴대폰 화면 인식 등록 필요" : TextOf(delivery,"reason")),
            ("다음 관측", producer ? LocalTime(TextOf(schedule,"nextObservationAt")) : "관측기 없음"),
            ("대기 관측 간격", TextOf(schedule,"intervalMs")),
            ("완료 기록 정리", TextOf(reconciliation,"completedRounds")), ("인식 예외 보존", TextOf(reconciliation,"recognitionOnlyRounds")),
            ("현재 납품 라운드", TextOf(delivery,"currentRoundId")), ("완료 라운드", TextOf(delivery,"completedRounds")),
            ("미결 입력", TextOf(Prop(automation,"input"),"id")), ("입력 상태", TextOf(Prop(automation,"input"),"status")),
            ("장부 장면", TextOf(scene,"kind")), ("화면 인식 후보",TextOf(Prop(Prop(snapshot,"matching"),"scene"),"kind")), ("epoch",TextOf(scene,"epoch")), ("촬영 수",TextOf(Prop(snapshot,"stats"),"captures")),
            ("OCR 완료",TextOf(Prop(snapshot,"stats"),"completed")), ("매칭 상태",Translate(TextOf(Prop(snapshot,"matching"),"status"))),
            ("정보 갱신 요청",TextOf(refreshRequest,"requestId")), ("갱신 진행",Translate(TextOf(refreshRequest,"status"))),
            (Bool(worker,"continuous")?"관측 구간":"관측 상한", string.IsNullOrEmpty(TextOf(worker,"maxCaptures"))?"관측기 없음":
                TextOf(worker,"maxCaptures")+"장"+(Bool(worker,"continuous")?(observationActive?" · 자동 갱신":" · 관측 중지"):"")),
            ("촬영 오류", TextOf(Prop(snapshot,"captureError"),"error")) }) stateRows.Add([label, content]);
        var stock = Prop(snapshot, "inventory"); var capacity = Prop(stock,"capacity");
        var inventoryCaption = $"재고: {Translate(TextOf(stock,"status"))} · 범위: {TextOf(stock,"coverage")} · {TextOf(stock,"error")}\r\n창고: {TextOf(capacity,"usedCapacity")} / {TextOf(capacity,"totalCapacity")} · 여유 {TextOf(capacity,"freeCapacity")} · {(Bool(capacity,"fresh") ? "최근 확인" : "재확인 필요")} / 빈 값은 미확정입니다.";
        foreach (var item in Items(stock,"rows")) inventoryRows.Add([TextOf(item,"itemId"), TextOf(item,"quantity"), TextOf(item,"reserved"), TextOf(item,"available"), Translate(TextOf(item,"status")), LocalTime(TextOf(item,"observedAt"))]);
        foreach (var order in Items(snapshot,"orders"))
        {
            var needs = Items(order,"needs").ToArray();
            if (needs.Length == 0) orderRows.Add([TextOf(order,"orderId"),TextOf(order,"kind"),"", "",Bool(order,"completed")?"예":"",LocalTime(TextOf(order,"observedAt")),Bool(order,"fresh")?"최근":"과거"]);
            foreach (var need in needs) orderRows.Add([TextOf(order,"orderId"),TextOf(order,"kind"),TextOf(need,"itemId"),TextOf(need,"required"),Bool(order,"completed")?"예":"",LocalTime(TextOf(order,"observedAt")),Bool(order,"fresh")?"최근":"과거"]);
        }
        var matching = Prop(snapshot,"matching"); foreach (var d in Items(matching,"detections")) detectionRows.Add([TextOf(d,"objectId"),TextOf(d,"kind"),TextOf(d,"score"),Prop(d,"box").ToString(),Translate(TextOf(matching,"coordinateState"))]);
        foreach (var a in Items(snapshot,"actions")) actionRows.Add([TextOf(a,"id"),TextOf(a,"kind"),TextOf(a,"status"),LocalTime(TextOf(a,"at")),TextOf(a,"error")]);
        return new(statusCaption,frameCaption,inventoryCaption,frame,stateRows.AsReadOnly(),
            new(Key(Prop(stock,"rows")),inventoryRows.AsReadOnly()),new(Key(Prop(snapshot,"orders")),orderRows.AsReadOnly()),
            new(Key(matching),detectionRows.AsReadOnly()),new(Key(Prop(snapshot,"actions")),actionRows.AsReadOnly()));
    }
}
