"""SOM's one default-quantity sale, using existing actual-game UI evidence."""
import hashlib
from pathlib import Path
import cv2
import numpy as np
from barn_sale import BarnSaleAnalyzer, score, crop, shifted


class SomBarn:
    def __init__(self, reference):
        self.reader = BarnSaleAnalyzer(Path(reference) / 'barn-sale/profile.json')
        self.profile_bytes = self.reader.path.read_bytes()
    def sale_labels(self, im, s, sx, sy):
        assets=self.reader.assets
        # Label/coin text moves horizontally with the displayed price. Search
        # only registered strips inside this popup's fixed SELL button, and
        # require the label and ordinary coin to keep their paired spacing.
        if not s.get('sellLabelSearch') or not s.get('coinSearch'):
            return all(score(crop(im,shifted(s[region],sx,sy)),assets[s[name]['file']])[0]>=.985
                for name,region in [('sellTemplate','sellLabel'),('coinTemplate','coin')])
        button=shifted(s['sell'],sx,sy)
        for group in [s,*s.get('labelAlternates',[])]:
            points=[]
            for name,region in [('sellTemplate','sellLabelSearch'),('coinTemplate','coinSearch')]:
                search=shifted(s[region],sx,sy);t=assets[group[name]['file']]
                value,pos=score(crop(im,search),t)
                if value<.985 or pos is None:break
                px,py=search['x']+pos[0],search['y']+pos[1]
                if px<button['x'] or py<button['y'] or px+t.shape[1]>button['x']+button['width'] or py+t.shape[0]>button['y']+button['height']:break
                points.append((px,py))
            if len(points)==2 and abs(points[1][0]-points[0][0]-(s['coin']['x']-s['sellLabel']['x']))<=1:
                return True
        return False

    def analyze(self, im, viewport):
        p=self.reader.p; panel=p['panel']; assets=self.reader.assets
        value,at=score(crop(im,viewport),assets[p['anchors']['title']['file']])
        if value<.985:return None
        x=viewport['x']+at[0]-panel['title']['x']; y=viewport['y']+at[1]-panel['title']['y']
        d=panel['dimensions']
        if x<viewport['x'] or y<viewport['y'] or x+d['width']>viewport['x']+viewport['width'] or y+d['height']>viewport['y']+viewport['height']:return None
        def matches(spec,b):
            pixels=crop(im,b);template=assets[spec['file']]
            if score(pixels,template)[0]<.985:return False
            if 'maximumMeanAbsoluteError' not in spec:return True
            limit=spec['maximumMeanAbsoluteError']
            return type(limit) in (int,float) and 0<=limit<=2 and pixels.shape==template.shape and np.abs(pixels.astype(float)-template).mean()<=limit
        if not matches(p['anchors']['close'],shifted(panel['close'],x,y)):return None
        # Keep the original capacity-label proof. Registered static variants
        # cover layouts where the count-dependent capacity text shifts.
        bottom_ok=matches(p['anchors']['bottom'],shifted(panel['bottom'],x,y))
        if not bottom_ok:
            def bottom_alternate(a):
                if not a.get('searchBox'):return matches(a,shifted(a['box'],x,y))
                # A count's glyph width moves the static capacity label. Search
                # only its registered strip, then apply the same pixel check.
                search=shifted(a['searchBox'],x,y)
                if search['x']<x or search['y']<y or search['x']+search['width']>x+d['width'] or search['y']+search['height']>y+d['height']:return False
                t=assets[a['file']];value,pos=score(crop(im,search),t)
                if value<.985 or pos is None:return False
                return matches(a,dict(x=search['x']+pos[0],y=search['y']+pos[1],width=t.shape[1],height=t.shape[0]))
            bottom_ok=any(bottom_alternate(a) for a in p.get('bottomAlternates',[]))
        if not bottom_ok:return None
        tabs=[]
        for tab in p['tabs']:
            search=shifted(tab['searchBox'],x,y); found=[]
            for state in ['active','inactive']:
                t=assets[tab[state]['file']];value,pos=score(crop(im,search),t)
                if value>=.985:
                    b=dict(x=search['x']+pos[0],y=search['y']+pos[1],width=t.shape[1],height=t.shape[0])
                    if np.abs(crop(im,b).astype(float)-t).mean()<=4:found.append(state)
            tabs.append(dict(id=tab['id'],box=shifted(tab['box'],x,y),state=found[0] if len(found)==1 else 'unknown'))
        active=[t['id'] for t in tabs if t['state']=='active']
        active_tab=active[0] if len(active)==1 else ('all' if not active and matches(p['anchors']['allTab'],shifted(panel['allTab'],x,y)) else None)
        sel=p['selection']; selected=None
        # Product names vary. The actual SELL/coin and +/- control layout
        # identifies a sale popup; its pointer must indicate one current slot.
        value,pos=score(crop(im,viewport),assets[sel['minusTemplate']['file']])
        if value>=.985:
            sx=viewport['x']+pos[0]-sel['minus']['x'];sy=viewport['y']+pos[1]-sel['minus']['y']
            sd=sel['dimensions']
            if sx>=viewport['x'] and sy>=viewport['y'] and sx+sd['width']<=viewport['x']+viewport['width'] and sy+sd['height']<=viewport['y']+viewport['height']:
                if matches(sel['plusTemplate'],shifted(sel['plus'],sx,sy)) and self.sale_labels(im,sel,sx,sy):
                    tip=(sx+sd['width']/2,sy if sel.get('pointer')=='top' else sy+sd['height'])
                    rows=[r for r in panel['rows'] if (lambda b:b['x']<=tip[0]<=b['x']+b['width'] and b['y']<=tip[1]<=b['y']+b['height'])(shifted(r['iconBox'],x,y))]
                    if len(rows)==1:
                        selected=dict(index=rows[0]['index'],sell=shifted(sel['sell'],sx,sy),
                                      hash=hashlib.sha256(crop(im,shifted(sel['popup'],sx,sy)).tobytes()).hexdigest())
        if not selected and not matches(p['anchors']['plainStrip'],shifted(panel['plainStrip'],x,y)):return None
        rows=[]
        if not selected and active_tab in ['crops','products']:
            for row in panel['rows']:
                b=shifted(row['iconBox'],x,y);pixels=crop(im,b)
                # The pale slot alone is empty. Colour/texture establish only
                # occupancy; the allowed tab supplies the sale category.
                occupied=bool(np.mean(np.min(pixels,axis=2)<160)>.08 and np.std(pixels.astype(float),axis=(0,1)).max()>25)
                rows.append(dict(index=row['index'],box=b,occupied=occupied,hash=hashlib.sha256(pixels.tobytes()).hexdigest()))
        return dict(scene='barn',panel=dict(x=x,y=y,**d),close=shifted(panel['close'],x,y),tabs=tabs,activeTab=active_tab,
                    selected=selected,rows=rows)
