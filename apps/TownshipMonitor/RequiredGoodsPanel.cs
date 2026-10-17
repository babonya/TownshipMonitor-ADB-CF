using System.Text.Json;

namespace TownshipMonitor;

// Presentation only: saved product images and the already-computed item totals.
internal sealed class RequiredGoodsPanel : Panel
{
    private sealed class Tile
    {
        public string ItemId = "", Quantity = "", Detail = "", Status = "";
        public Rectangle Bounds;
    }
    private sealed class Section
    {
        public string Title = "", Detail = "";
        public Rectangle Header;
        public int Bottom;
        public List<Tile> Tiles = [];
    }
    private readonly ProductDisplayAssets assets;
    private readonly List<Section> sections = [];
    private readonly ToolTip tooltip = new() { InitialDelay = 350, ReshowDelay = 80, AutoPopDelay = 15000, ShowAlways = true };
    private readonly Font titleFont = new("맑은 고딕", 10F, FontStyle.Bold);
    private readonly Font quantityFont = new("맑은 고딕", 10F, FontStyle.Bold);
    private string? dataKey, hoverDetail;
    private Tile? hovered;
    public int ItemCount => sections.Sum(s=>s.Tiles.Count);

    public RequiredGoodsPanel(string root)
    {
        Dock = DockStyle.Fill; AutoScroll = true; DoubleBuffered = true; BackColor = Color.White;
        AccessibleName = "납품장소별 필요 물품 이미지";
        assets = new ProductDisplayAssets(root);
        SizeChanged += (_,_)=>Reflow();
    }

    public void UpdateSnapshot(JsonElement data)
    {
        var key = data.ValueKind == JsonValueKind.Undefined ? "" : data.GetRawText();
        if (key == dataKey) return;
        dataKey = key; sections.Clear(); hovered = null; hoverDetail = null; tooltip.SetToolTip(this,null);
        var som=data.ValueKind==JsonValueKind.Object && data.TryGetProperty("mode",out var mode) && mode.GetString()=="som";
        assets.UpdateTemporaryImages(data);
        foreach (var model in RequiredGoodsPresentation.BuildSections(data,som?new Dictionary<string,string>():assets.Names))
        {
            var section = new Section { Title=model.Title, Detail=model.Detail };
            section.Tiles.AddRange(model.Tiles.Select(tile=>new Tile { ItemId=tile.ItemId, Quantity=tile.Quantity, Status=tile.Status, Detail=tile.Detail }));
            sections.Add(section);
        }
        Reflow();
    }
    private int U(int value)=>(int)Math.Round(value*DeviceDpi/96F);
    private void Reflow()
    {
        var padding=U(10); var step=U(64);
        var width=Math.Max(step,ClientSize.Width-padding*2-SystemInformation.VerticalScrollBarWidth);
        var columns=Math.Max(1,width/step); var y=padding;
        foreach (var section in sections)
        {
            section.Header=new Rectangle(padding,y,width,U(24)); y+=U(28);
            var tileHeight=U(section.Tiles.Any(tile=>tile.Quantity.Length>0)?78:56);
            var rowStep=tileHeight+U(6);
            for (var i=0;i<section.Tiles.Count;i++) section.Tiles[i].Bounds=new Rectangle(padding+i%columns*step,y+i/columns*rowStep,U(56),tileHeight);
            y+=(section.Tiles.Count+columns-1)/columns*rowStep+U(6);
            section.Bottom=y; y+=U(8);
        }
        AutoScrollMinSize=new Size(0,y); Invalidate();
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var offset=AutoScrollPosition;
        using var border=new Pen(Color.FromArgb(225,230,237));
        using var hoverBrush=new SolidBrush(Color.FromArgb(239,246,255));
        foreach (var section in sections)
        {
            var header=section.Header; header.Offset(offset);
            TextRenderer.DrawText(e.Graphics,section.Title,titleFont,header,Color.FromArgb(38,53,73),TextFormatFlags.Left|TextFormatFlags.VerticalCenter|TextFormatFlags.SingleLine|TextFormatFlags.EndEllipsis);
            foreach (var tile in section.Tiles)
            {
                var bounds=tile.Bounds; bounds.Offset(offset); if (!bounds.IntersectsWith(e.ClipRectangle)) continue;
                if (tile==hovered) e.Graphics.FillRectangle(hoverBrush,bounds);
                var hasQuantity=tile.Quantity.Length>0;
                if (hasQuantity)
                {
                    var number=new Rectangle(bounds.X,bounds.Y,bounds.Width,U(22));
                    TextRenderer.DrawText(e.Graphics,tile.Quantity,quantityFont,number,tile.Status is "shortage" or "partial"?Color.Firebrick:Color.FromArgb(89,100,113),TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter|TextFormatFlags.SingleLine|TextFormatFlags.EndEllipsis);
                }
                var icon=new Rectangle(bounds.X+U(4),bounds.Y+U(hasQuantity?26:4),U(48),U(48));
                var image=tile.Status=="som"?assets.TemporaryImage(tile.ItemId):assets.ProductImage(tile.ItemId);
                if (image is not null)
                {
                    var scale=Math.Min((float)icon.Width/image.Width,(float)icon.Height/image.Height);
                    var w=(int)(image.Width*scale); var h=(int)(image.Height*scale);
                    e.Graphics.DrawImage(image,new Rectangle(icon.X+(icon.Width-w)/2,icon.Y+(icon.Height-h)/2,w,h));
                }
                else
                {
                    e.Graphics.DrawRectangle(border,icon);
                    TextRenderer.DrawText(e.Graphics,tile.ItemId.Length>0?assets.Names.GetValueOrDefault(tile.ItemId,tile.ItemId):"?",Font,icon,Color.Gray,
                        TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter|TextFormatFlags.WordBreak|TextFormatFlags.EndEllipsis);
                }
            }
            if (section!=sections.Last()) e.Graphics.DrawLine(border,U(10),section.Bottom+offset.Y,ClientSize.Width-U(10),section.Bottom+offset.Y);
        }
    }
    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e); var point=new Point(e.X-AutoScrollPosition.X,e.Y-AutoScrollPosition.Y);
        var tile=sections.SelectMany(s=>s.Tiles).FirstOrDefault(t=>t.Bounds.Contains(point));
        var detail=tile?.Detail??sections.FirstOrDefault(s=>s.Header.Contains(point))?.Detail;
        if (hovered!=tile) { hovered=tile; Invalidate(); }
        if (hoverDetail!=detail) { hoverDetail=detail; tooltip.SetToolTip(this,detail); }
    }
    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e); hovered=null; hoverDetail=null; tooltip.SetToolTip(this,null); Invalidate();
    }
    protected override void OnScroll(ScrollEventArgs se)
    {
        base.OnScroll(se); hovered=null; hoverDetail=null; tooltip.SetToolTip(this,null); Invalidate();
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { tooltip.Dispose(); titleFont.Dispose(); quantityFont.Dispose(); assets.Dispose(); }
        base.Dispose(disposing);
    }
}

