using System.Text.Json;
namespace TownshipMonitor;
internal static class MonitorDisplayText
{
    internal static (string Label,string Resume) OperationIssue(string code)=>code switch {
        "paused"=>("사용자 일시중지","시작 버튼을 누르면 현재 화면부터 다시 확인합니다."),
        "input_result"=>("입력 결과 확인 필요","연결된 원본과 결과를 확인할 때까지 추가 입력을 차단합니다."),
        "registration_wait"=>("상품 등록 대기","AI가 상품 증거를 검증·적용한 뒤 현재 주문을 다시 읽습니다."),
        "quantity_unknown"=>("수량 판독 실패","현재 보유량과 필요량을 읽으면 주문을 다시 판단합니다."),
        "location_unknown"=>("화면 또는 상품 위치 미확인","지원되는 화면 크기와 현재 게임 영역을 확인해야 합니다."),
        "stock_shortage"=>("재고 부족","필요한 상품의 구매 가능 여부를 확인한 뒤 현재 주문을 다시 읽습니다."),
        "market_refresh"=>("시장 갱신 대기","확인된 무료 갱신 조건이나 다음 관측 시점에 다시 확인합니다."),
        "barn_space"=>("창고 공간 부족","가능한 납품을 먼저 처리합니다. 새싹·빵 탭의 등록된 상품만 기본 수량과 주문 재고를 확인해 판매합니다."),
        "barn_recheck"=>("창고 부족 상태 재확인","이전 공간 부족 이후 현재 수요와 공간을 다시 확인해야 합니다. 새 구매·판매를 승인하는 상태가 아닙니다."),
        "coins_shortage"=>("구매 코인 부족","코인 부족 결과가 확인되었습니다. 조건이 바뀌면 현재 주문과 상품을 다시 확인합니다."),
        "market_unavailable"=>("시장 구매 확인 필요","상품 또는 창고 공간을 현재 화면에서 확인해야 구매할 수 있습니다."),
        "screen_exception"=>("정보창·팝업 확인 필요","등록된 무료 동작과 현재 화면을 확인한 뒤 재개합니다."),
        _=>("상태 확인 필요","상세 사유와 현재 화면을 확인해 주세요.")};
    internal static JsonElement Prop(JsonElement value,string key) => value.ValueKind==JsonValueKind.Object && value.TryGetProperty(key,out var result)?result:default;
    internal static string TextOf(JsonElement value,string key) { var p=Prop(value,key); return p.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined?"":p.ValueKind==JsonValueKind.String?p.GetString()??"":p.ToString(); }
    internal static bool Bool(JsonElement value,string key)=>Prop(value,key).ValueKind==JsonValueKind.True;
    internal static bool Number(JsonElement value,string key,out float number) { number=0; var p=Prop(value,key); return p.ValueKind==JsonValueKind.Number && p.TryGetSingle(out number); }
    internal static IEnumerable<JsonElement> Items(JsonElement value,string key) { var p=Prop(value,key); return p.ValueKind==JsonValueKind.Array?p.EnumerateArray():Enumerable.Empty<JsonElement>(); }
    internal static string LocalTime(string value)=>DateTimeOffset.TryParse(value,out var at)?at.ToOffset(TimeSpan.FromHours(9)).ToString("MM-dd HH:mm:ss")+" KST":value;
    internal static string Translate(string value)=>value switch { "observer_unavailable"=>"관측기 없음", "reconciling"=>"이전 기록 정리 중", "not_started"=>"시작 대기", "waiting"=>"대기", "recognizing"=>"주문 판독 중", "delivering"=>"납품 라운드 실행 중", "requested"=>"갱신 요청됨", "awaiting_review"=>"새 화면 판독 대기", "reviewing"=>"항목 확인 중", "complete"=>"갱신 완료", "partial"=>"일부 확인", "pending"=>"확인 대기", "paused"=>"일시중지", "observing"=>"관측 중", "idle"=>"대기", "waiting_result"=>"결과 확인 대기", "stopping"=>"중지 처리 중", "starting"=>"시작 준비", "running"=>"실행 중", "completed"=>"회차 완료", "candidate"=>"미검토 후보", "stale"=>"재확인 필요", "requires_sync"=>"재고 동기화 필요", "observations_only"=>"창고 관측값 (예약 미확정)", "observed_only"=>"관측값", "confirmed"=>"확인됨", "ready"=>"준비됨", "unobserved"=>"재고 미관측", "not_available"=>"매칭 결과 없음", "waiting_current_frame"=>"현재 원본 분석 대기", "fresh"=>"최근", "expired"=>"만료", "hold"=>"보류", "error"=>"오류", _=>value };
    internal static string SectionName(string name) => name switch { "screen" => "현재 화면", "orders" => "주문", "inventory" => "창고", "market" => "시장", "resources" => "코인", _ => name };
}
