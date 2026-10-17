using System.Text.Json;

namespace TownshipMonitor;

internal sealed record RequiredGoodsTile(string ItemId, string Quantity, string Status, string Detail);
internal sealed record RequiredGoodsSection(string Title, string Detail, IReadOnlyList<RequiredGoodsTile> Tiles);

// Display projection only. Order allocation and stock truth remain in the worker.
internal static class RequiredGoodsPresentation
{
    public static IReadOnlyList<RequiredGoodsSection> BuildSections(JsonElement data, IReadOnlyDictionary<string,string> names)
    {
        if (Value(data,"mode") == "som")
        {
            var images=Items(data,"images").Select(image=>new RequiredGoodsTile(Value(image,"id"),"","som","현재 주문에서 모은 상품 이미지")).ToArray();
            var failed=Items(data,"failedImages").Select(image=>new RequiredGoodsTile(Value(image,"id"),"","som",
                Value(image,"reason")=="purchase_shortage_repeated"?"구매 후 부족 지속 "+Value(image,"failures")+"회":"시장 전체 탐색 후 상품 없음")).ToArray();
            return [new RequiredGoodsSection(images.Length>0?"헬리콥터":"필요 물품 없음","",images),
                new RequiredGoodsSection("실패 상품 ("+failed.Length+")","현재 시장 세션에서 구매 대상에서 제외한 상품",failed)];
        }
        var rows = Items(data,"itemRows").ToLookup(row=>Value(row,"transport"));
        var sections = new List<RequiredGoodsSection>();
        foreach (var group in Items(data,"groups"))
        {
            var detail = Status(Value(group,"status"))+"\n확인 시각: "+Time(Value(group,"observedAt"));
            var tiles = new List<RequiredGoodsTile>();
            foreach (var item in rows[Value(group,"transport")])
            {
                var state = Value(item,"status"); if (state is "sufficient" or "stale") continue;
                var id = Value(item,"itemId"); var shortage = Value(item,"shortage");
                var name = names.TryGetValue(id,out var knownName) ? knownName : id.Length>0?id:"품목 확인 필요";
                var confirmed = Value(item,"confirmedShortage");
                var partial = state=="partial" && long.TryParse(confirmed,out var known) && known>0;
                var quantity = shortage.Length>0 ? shortage : partial ? confirmed+" + ?" : state=="supply_excluded" ? "—" : "?";
                var itemDetail = partial ? "확인된 주문 부족량: "+confirmed+"\n추가 수요: 미확정 ("+Value(item,"uncertainOrderCount")+"건)" : "부족량: "+(shortage.Length>0?shortage:"미확정");
                var recognition=Items(item,"recognitionReasons").Select(x=>x.GetString() switch {"product_identity"=>"상품 등록 대기","quantity"=>"수량 판독 실패",_=>"위치 확인 필요"});
                itemDetail += "\n"+string.Join(" · ",recognition)+"\n영향 주문: "+string.Join(", ",Items(item,"orderIds").Select(x=>x.ToString()));
                tiles.Add(new(id,quantity,state,name+"\n"+itemDetail+"\n"+Status(state)+"\n확인 시각: "+Time(Value(item,"observedAt"))));
            }
            if (tiles.Count==0) tiles.Add(new("","—","empty",detail));
            sections.Add(new(Value(group,"label"),detail,tiles));
        }
        return sections;
    }
    private static string Value(JsonElement value,string key)=>value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(key,out var result)&&result.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)?result.ToString():"";
    private static IEnumerable<JsonElement> Items(JsonElement value,string key)=>value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(key,out var result)&&result.ValueKind==JsonValueKind.Array?result.EnumerateArray():Enumerable.Empty<JsonElement>();
    private static string Time(string value)=>DateTimeOffset.TryParse(value,out var at)?at.ToOffset(TimeSpan.FromHours(9)).ToString("MM-dd HH:mm:ss")+" KST":"미확인";
    private static string Status(string value)=>value switch {
        "shortage"=>"부족", "sufficient"=>"확인된 주문의 재고 충분", "unobserved"=>"납품 정보 확인 필요", "partial"=>"일부 정보 확인 필요",
        "supply_excluded"=>"공급 제외 (8개 이상 주문)", "allocation_unknown"=>"재고 폴더 연결 필요", "allocation_pending"=>"주문 배정 갱신 필요",
        "input_unresolved"=>"입력 결과 확인 대기", "inventory_error"=>"재고 정보 오류", "order_changed"=>"변경된 주문 확인 필요",
        "hold"=>"주문·재고 확인 필요", "unknown"=>"품목·수량 확인 필요", "stale"=>"재확인 필요", "requires_sync"=>"재고 동기화 필요", _=>value };
}
