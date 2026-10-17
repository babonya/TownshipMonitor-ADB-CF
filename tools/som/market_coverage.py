"""Account for expected market slots before concluding no goods matched."""
import hashlib,base64
import cv2
import numpy as np

def visible_sold_coverage(view,rows,cw,ch,cells,ends):
    """Prove all fully visible cards sold, independently of drag geometry."""
    if not cells or not all(c['state']=='sold' for c in cells):return False
    slots=[c['card'] for c in cells]
    for marker in ends:
        if marker.get('role')=='observed_last_card':continue
        row=min(rows,key=lambda y:abs(marker['y']+marker['height']/2-(y+ch*.35)))
        slots.append(dict(x=marker['x']+marker['width']/2-cw/2,y=row,width=cw,height=ch))
    for row in rows:
        line=sorted((c for c in slots if abs(c['y']-row)<=3),key=lambda c:c['x'])
        gaps=[b['x']-a['x'] for a,b in zip(line,line[1:])]
        if not gaps or any(not cw<=gap<=cw*1.25 for gap in gaps):return False
        pitch=float(np.median(gaps))
        if any(abs(gap-pitch)>3 for gap in gaps):return False
        for x in (line[0]['x']-pitch,line[-1]['x']+pitch):
            if view['x']<=x and x+cw<=view['x']+view['width']:return False
    return True

class MarketCoverage:
    def sale(self,im,x,y,cw,ch):
        # Read only the label above the excluded first-column card.
        b=dict(x=round(x),y=round(y-ch*.20),width=cw,height=round(ch*.25))
        height,width=im.shape[:2]
        if b['x']<0 or b['y']<0 or b['x']+cw>width or b['y']+b['height']>height:return None
        pixels=im[b['y']:b['y']+b['height'],b['x']:b['x']+cw]
        return dict(box=b,region={k:b[k]/(width if k in ('x','width') else height) for k in b},
                    hash=hashlib.sha256(pixels.tobytes()).hexdigest(),
                    image='data:image/png;base64,'+base64.b64encode(cv2.imencode('.png',pixels)[1]).decode())

    def read(self,im,view,rows,cw,ch,cells,geometry,plus,sale_region,sale_marks,partial_cards=()):
        result=dict(complete=False,leftEdgeComplete=False,rightEdgeComplete=False,terminalVerified=False,geometryComplete=False,saleChecks=[])
        if not geometry or geometry.get('basis')!=view or not cells:return result
        pitch=geometry['pitch']*view['width']
        if not np.isfinite(pitch) or not cw<=pitch<=cw*1.3:return result
        origin=cells[0]['card']['x'];left=view['x'];right=left+view['width']
        # Grid alignment is measured from this frame; it supplies no click.
        if any(abs((c['card']['x']-origin)/pitch-round((c['card']['x']-origin)/pitch))*pitch>3 for c in cells):return result
        xs=[origin+k*pitch for k in range(-12,13) if origin+k*pitch>=left-1 and origin+k*pitch+cw<=right+1]
        if not xs:return result
        result['leftEdgeComplete']=bool(xs[0]-pitch+cw<=left+3)
        right_complete=[]
        terminal=[]
        for y in rows:
            ends=[b['x']+b['width']/2+(pitch if b.get('role')=='observed_last_card' else 0)
                  for b in plus if y<=b['y']+b['height']/2<=y+ch]
            if any(abs((center-cw/2-origin)/pitch-round((center-cw/2-origin)/pitch))*pitch>5 for center in ends):return result
            end=min(ends) if ends else None
            for x in xs:
                if end is not None and x+cw/2>=end-3:continue
                matches=[c for c in cells if abs(c['card']['x']-x)<=3 and abs(c['card']['y']-y)<=3]
                # A detected card with unread content still proves this slot was scanned.
                # The visit separately excludes the original first column by position.
                if any(c['state'] in ('offer','sold','unknown') for c in matches):continue
                # Only a registered card-border observation can establish that
                # a projected edge slot is clipped. Grid rounding alone cannot.
                if any(abs(c['x']-x)<=3 and c['y']==y and c['width']==cw and c['height']==ch and
                       (c['x']<left or c['x']+cw>right) for c in partial_cards):continue
                if sale_region['x']<=x+cw/2<=sale_region['x']+sale_region['width'] and x<=left+cw*.20:
                    label=any(abs(b['x']+b['width']/2-(x+cw/2))<cw*.1 and y-ch*.2<=b['y']+b['height']/2<=y+ch*.08 for b in sale_marks)
                    if label:continue
                    candidate=self.sale(im,x,y,cw,ch)
                    if candidate:
                        result['saleChecks'].append(candidate);continue
                return result
            right_complete.append(end is not None or xs[-1]+pitch>=right-3)
            terminal.append(end is not None)
        result['geometryComplete']=True;result['complete']=not result['saleChecks'];result['rightEdgeComplete']=all(right_complete)
        result['terminalVerified']=all(terminal)
        return result
