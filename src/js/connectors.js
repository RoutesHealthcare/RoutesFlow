/* ---------- connectors and glue ---------- */
import {NS, PX, S, WALK, cellEl, delCell, insertSection, kid, kids, mk, setCell} from './core.js';
import {is1D, num, shapeCtx} from './visio-package.js';
import {pageCtx} from './render.js';
import {delUser, parseVia, setUser, userV, viaToStr} from './flow/model.js';

export function connectsEl(doc,create){
  const root=doc.documentElement; let c=kid(root,'Connects');
  if(!c&&create){ c=doc.createElementNS(NS,'Connects'); const sh=kid(root,'Shapes'); root.insertBefore(c,sh?sh.nextSibling:null); }
  return c;
}
export function listConnects(){
  return kids(connectsEl(pageCtx().doc,false),'Connect').map(c=>({el:c,from:c.getAttribute('FromSheet'),fromCell:c.getAttribute('FromCell'),to:c.getAttribute('ToSheet')}));
}
export function setGlue(cid,end,toId){
  const doc=pageCtx().doc, ce=connectsEl(doc,true);
  for(const c of kids(ce,'Connect')) if(c.getAttribute('FromSheet')===cid&&c.getAttribute('FromCell')===end+'X') c.remove();
  if(toId) ce.appendChild(mk(doc,'Connect',{FromSheet:cid,FromCell:end+'X',FromPart:end==='Begin'?'9':'12',ToSheet:toId,ToCell:'PinX',ToPart:'3'}));
  if(!kids(ce,'Connect').length) ce.remove();
}
function raySeg(p,d,a,b){
  const e=[b[0]-a[0],b[1]-a[1]], den=d[0]*e[1]-d[1]*e[0]; if(Math.abs(den)<1e-12) return null;
  const w=[a[0]-p[0],a[1]-p[1]], t=(w[0]*e[1]-w[1]*e[0])/den, u=(w[0]*d[1]-w[1]*d[0])/den;
  return (u<-1e-9||u>1+1e-9)?null:t;
}
export const centreOf=id=>{ const b=S.boxes[id]; return [(b.x0+b.x1)/2,(b.y0+b.y1)/2]; };
function anchorFor(id,toward){
  const b=S.boxes[id], c=centreOf(id);
  const polys=S.polys[id]||[[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]]];
  const d=[toward[0]-c[0],toward[1]-c[1]]; if(Math.hypot(d[0],d[1])<1e-6) return c;
  let best=null;
  for(const poly of polys) for(let i=0;i<poly.length;i++){
    const t=raySeg(c,d,poly[i],poly[(i+1)%poly.length]);
    if(t!=null&&t>1e-6&&(best==null||t<best)) best=t;
  }
  if(best==null) return c; const t=Math.min(best,1); return [c[0]+d[0]*t,c[1]+d[1]*t];
}
/* b, e and bends are page inches. With bends the line is drawn as a polyline the way Visio stores its dynamic
   connectors: no rotation, Width and Height spanning begin to end, and one geometry row per point. */
export function setConnector(el,b,e,bTo,eTo,bends=[]){
  const doc=el.ownerDocument, L=Math.hypot(e[0]-b[0],e[1]-b[1]), ang=Math.atan2(e[1]-b[1],e[0]-b[0]);
  if(bTo||eTo){
    setCell(el,'BegTrigger',bTo?2:0,bTo?`_XFTRIGGER(Sheet.${bTo}!EventXFMod)`:undefined);
    setCell(el,'EndTrigger',eTo?2:0,eTo?`_XFTRIGGER(Sheet.${eTo}!EventXFMod)`:undefined);
  } else { delCell(el,'BegTrigger'); delCell(el,'EndTrigger'); }
  setCell(el,'BeginX',b[0],bTo?WALK:undefined); setCell(el,'BeginY',b[1],bTo?WALK:undefined);
  setCell(el,'EndX',e[0],eTo?WALK:undefined); setCell(el,'EndY',e[1],eTo?WALK:undefined);
  setCell(el,'PinX',(b[0]+e[0])/2,'GUARD((BeginX+EndX)/2)'); setCell(el,'PinY',(b[1]+e[1])/2,'GUARD((BeginY+EndY)/2)');
  setCell(el,'FlipX',0); setCell(el,'FlipY',0);
  for(const s of kids(el,'Section')) if(s.getAttribute('N')==='Geometry') s.remove();
  const sec=mk(doc,'Section',{N:'Geometry',IX:'0'},[cellEl(doc,'NoFill',1),cellEl(doc,'NoLine',0),cellEl(doc,'NoShow',0)]);
  let rowCount;
  if(bends.length){
    const W=e[0]-b[0], H=e[1]-b[1], local=[[0,0],...[...bends,e].map(p=>[p[0]-b[0],p[1]-b[1]])];
    setCell(el,'Width',W,'GUARD(EndX-BeginX)'); setCell(el,'Height',H,'GUARD(EndY-BeginY)'); setCell(el,'Angle',0);
    setCell(el,'LocPinX',W/2,'GUARD(Width*0.5)'); setCell(el,'LocPinY',H/2,'GUARD(Height*0.5)');
    local.forEach((p,i)=>sec.appendChild(mk(doc,'Row',{T:i?'LineTo':'MoveTo',IX:String(i+1)},[cellEl(doc,'X',p[0]),cellEl(doc,'Y',p[1])])));
    const mid=pathMidpoint(local); setCell(el,'TxtPinX',mid[0]); setCell(el,'TxtPinY',mid[1]);   // the label sits halfway along the line
    rowCount=local.length;
  } else {
    setCell(el,'Width',L,'GUARD(SQRT((EndX-BeginX)^2+(EndY-BeginY)^2))'); setCell(el,'Height',0);
    setCell(el,'Angle',ang,'GUARD(ATAN2(EndY-BeginY,EndX-BeginX))');
    setCell(el,'LocPinX',L/2,'GUARD(Width*0.5)'); setCell(el,'LocPinY',0,'GUARD(Height*0.5)');
    delCell(el,'TxtPinX'); delCell(el,'TxtPinY');
    sec.appendChild(mk(doc,'Row',{T:'MoveTo',IX:'1'},[cellEl(doc,'X',0,'Width*0'),cellEl(doc,'Y',0,'Height*0.5')]));
    sec.appendChild(mk(doc,'Row',{T:'LineTo',IX:'2'},[cellEl(doc,'X',L,'Width*1'),cellEl(doc,'Y',0,'Height*0.5')]));
    rowCount=2;
  }
  const sh=shapeCtx(el,null);
  if(sh.mel) for(const ms of kids(sh.mel,'Section')) if(ms.getAttribute('N')==='Geometry'){
    const ix=ms.getAttribute('IX')||'0';
    if(ix==='0'){ for(const r of kids(ms,'Row')){ const rix=r.getAttribute('IX'); if(+rix>rowCount) sec.appendChild(mk(doc,'Row',{T:r.getAttribute('T'),IX:rix,Del:'1'})); } }
    else insertSection(el,mk(doc,'Section',{N:'Geometry',IX:ix,Del:'1'}));
  }
  insertSection(el,sec);
}
/* The shapes a connector's two ends are glued to, when those shapes are drawn */
function gluedEnds(cid){
  const cons=listConnects().filter(c=>c.from===cid);
  let bTo=(cons.find(c=>c.fromCell==='BeginX')||{}).to||null, eTo=(cons.find(c=>c.fromCell==='EndX')||{}).to||null;
  if(bTo&&!S.boxes[bTo]) bTo=null; if(eTo&&!S.boxes[eTo]) eTo=null;
  return {bTo,eTo};
}
const mmToPx=([x,y])=>[x/25.4*PX,y/25.4*PX], pxToMM=([x,y])=>[x/PX*25.4,y/PX*25.4];
/* A right-angled line's bend points, in mm from the page's top-left corner, as stored on the connector */
export const bendsMM=cid=>{ const el=S.elById[cid]; return el?parseVia(userV(el,'FlowVia'))||[]:[]; };
export function setBends(cid,via){ const el=S.elById[cid]; if(!el) return; if(via&&via.length) setUser(el,'FlowVia',viaToStr(via)); else delUser(el,'FlowVia'); }
/* Bend points from an import only fit the shapes where they were; dragging a line's end off its shape re-routes it */
export function clearBends(cid){ setBends(cid,null); }
function endsPx(el){ const pg=pageCtx(), sh=shapeCtx(el,null), toPx=(x,y)=>[x*PX,(pg.h-y)*PX];
  return [toPx(num(sh,'BeginX',0),num(sh,'BeginY',0)),toPx(num(sh,'EndX',0),num(sh,'EndY',0))]; }

export function refreshConnector(cid){
  const pg=pageCtx(), el=S.elById[cid];
  if(!el||el.parentNode!==kid(pg.doc.documentElement,'Shapes')) return;
  const toIn=q=>[q[0]/PX,pg.h-q[1]/PX], {bTo,eTo}=gluedEnds(cid);
  let [b,e]=endsPx(el);
  if(userV(el,'FlowRoute')==='elbow'){
    const via=bendsMM(cid).map(mmToPx), fitted=fitBends(via,bTo,eTo);
    if(fitted.changed) setBends(cid,fitted.via.map(pxToMM));
    const pts=elbowRoute(bTo,eTo,b,e,fitted.via);
    setConnector(el,toIn(pts[0]),toIn(pts[pts.length-1]),bTo,eTo,pts.slice(1,-1).map(toIn));
    return;
  }
  const bc=bTo?centreOf(bTo):b, ec=eTo?centreOf(eTo):e;
  if(bTo) b=anchorFor(bTo,ec); if(eTo) e=anchorFor(eTo,bc);
  setConnector(el,toIn(b),toIn(e),bTo,eTo);
}
/* Every point of a right-angled line as drawn now, in page pixels, ends included */
export function routePoints(cid){
  const el=S.elById[cid]; if(!el) return [];
  const {bTo,eTo}=gluedEnds(cid), [b,e]=endsPx(el);
  return elbowRoute(bTo,eTo,b,e,fitBends(bendsMM(cid).map(mmToPx),bTo,eTo).via);
}

/* ---------- moving shapes ---------- */
function withChildren(ids){
  const out=new Set();
  for(const id of ids){ const el=S.elById[id]; if(!el) continue; out.add(id); for(const s of el.getElementsByTagNameNS(NS,'Shape')) out.add(s.getAttribute('ID')); }
  return out;
}
const linesTouching=moved=>new Set(listConnects().filter(c=>moved.has(c.to)).map(c=>c.from));
/* The bends of every line attached to these shapes, so a drag can always work from where they started */
export function bendsAround(ids){ const m=new Map(); for(const c of linesTouching(withChildren(ids))) m.set(c,bendsMM(c)); return m; }
/* Re-routes the lines attached to shapes that moved or changed size. With shift ({dx,dy} in page inches, and
   optionally `from`, the bends when the move began) a line whose two ends both moved keeps its route and moves
   with them; a line with one end moved keeps its bends, and the one next to that end slides to stay square. */
export function refreshForMany(ids,shift){
  const moved=withChildren(ids);
  for(const c of linesTouching(moved)){
    if(shift){
      const ends=listConnects().filter(x=>x.from===c), both=ends.length===2&&ends.every(x=>moved.has(x.to));
      const base=shift.from&&shift.from.has(c)?shift.from.get(c):bendsMM(c);
      setBends(c,both?base.map(([x,y])=>[x+shift.dx*25.4,y-shift.dy*25.4]):base);
    }
    refreshConnector(c);
  }
}
export const refreshFor=id=>refreshForMany([id]);

/* ---------- right-angled routing (page pixels) ---------- */
const STUB=12;          // px a routed line runs straight out of a shape before it turns
const CLEAR=12;         // px a routed line keeps from shapes it passes
function pathMidpoint(pts){
  const seg=pts.slice(1).map((p,i)=>Math.hypot(p[0]-pts[i][0],p[1]-pts[i][1])), total=seg.reduce((a,b)=>a+b,0);
  let left=total/2;
  for(let i=0;i<seg.length;i++){ if(left<=seg[i]&&seg[i]>0){ const t=left/seg[i], a=pts[i], c=pts[i+1]; return [a[0]+(c[0]-a[0])*t,a[1]+(c[1]-a[1])*t]; } left-=seg[i]; }
  return pts[pts.length-1];
}
/* Where a line from `from` heading along `dir` first meets the outline of shape `id` */
function hitAlong(id,from,dir){
  const b=S.boxes[id], polys=S.polys[id]||[[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]]]; let best=null;
  for(const poly of polys) for(let i=0;i<poly.length;i++){
    const t=raySeg(from,dir,poly[i],poly[(i+1)%poly.length]); if(t!=null&&t>1e-6&&(best==null||t<best)) best=t; }
  return best==null?null:[from[0]+dir[0]*best,from[1]+dir[1]*best];
}
/* The point on shape `id` where a horizontal or vertical line from `toward` lands, or the nearest edge point if
   `toward` is not level with the shape in either direction */
function landOn(id,toward){
  const b=S.boxes[id], [x,y]=toward; let p=null;
  if(y>=b.y0&&y<=b.y1&&(x<b.x0||x>b.x1)) p=hitAlong(id,toward,[x<b.x0?1:-1,0]);
  else if(x>=b.x0&&x<=b.x1&&(y<b.y0||y>b.y1)) p=hitAlong(id,toward,[0,y<b.y0?1:-1]);
  return p||anchorFor(id,toward);
}
const boxOf=(id,p)=>id?S.boxes[id]:{x0:p[0],x1:p[0],y0:p[1],y1:p[1]};
const level=(p,q)=>Math.abs(p[0]-q[0])<0.5||Math.abs(p[1]-q[1])<0.5;
/* Drops repeated points and points in the middle of a straight run */
function simplify(pts){
  const out=[];
  for(const p of pts){ const q=out[out.length-1]; if(!q||Math.hypot(p[0]-q[0],p[1]-q[1])>0.5) out.push(p); }
  for(let i=out.length-2;i>0;i--){ const a=out[i-1], b=out[i], c=out[i+1];
    if((Math.abs(a[0]-b[0])<0.5&&Math.abs(b[0]-c[0])<0.5)||(Math.abs(a[1]-b[1])<0.5&&Math.abs(b[1]-c[1])<0.5)) out.splice(i,1); }
  return out;
}
/* Every point of a right-angled line, ends included: through its bend points when it has them, otherwise along
   the best route found by autoRoute */
function elbowRoute(bTo,eTo,b,e,via){
  if(!via.length) return autoRoute(bTo,eTo,b,e);
  return simplify([bTo?landOn(bTo,via[0]):b,...via,eTo?landOn(eTo,via[via.length-1]):e]);
}
/* Keeps a right-angled line meeting its shapes square after a shape moved or was resized: the bend next to an
   end slides along its segment until it is level with that shape again. The other bends stay where they were. */
function fitBends(via,bTo,eTo){
  const n=via.length; if(!n) return {via,changed:false};
  const v=via.map(p=>[...p]), A=bTo&&S.boxes[bTo], B=eTo&&S.boxes[eTo];
  const inX=(p,r)=>p[0]>=r.x0&&p[0]<=r.x1, inY=(p,r)=>p[1]>=r.y0&&p[1]<=r.y1, vertical=(p,q)=>Math.abs(p[0]-q[0])<0.5;
  // segments alternate, so the segment after the first bend says which way the line leaves its first shape
  const firstAcross=n>1?vertical(v[0],v[1]):A?inY(v[0],A):B?inX(v[0],B):true;
  const lastAcross=n>1?vertical(v[n-1],v[n-2]):!firstAcross;
  if(A){ const c=centreOf(bTo); if(firstAcross){ if(!inY(v[0],A)) v[0][1]=c[1]; } else if(!inX(v[0],A)) v[0][0]=c[0]; }
  if(B){ const c=centreOf(eTo), p=v[n-1]; if(lastAcross){ if(!inY(p,B)) p[1]=c[1]; } else if(!inX(p,B)) p[0]=c[0]; }
  return {via:v,changed:v.some((p,i)=>p[0]!==via[i][0]||p[1]!==via[i][1])};
}
/* Shapes a line should go round: every drawn top-level shape except lines and the two it joins */
function obstacles(skip){
  const out=[];
  for(const el of kids(kid(pageCtx().doc.documentElement,'Shapes'),'Shape')){
    const id=el.getAttribute('ID'), b=S.boxes[id]; if(!b||skip.includes(id)||is1D(shapeCtx(el,null))) continue; out.push(b); }
  return out;
}
/* How many of the boxes an axis-aligned segment passes through */
function crossings(p,q,boxes,pad=2){
  let n=0; const x0=Math.min(p[0],q[0]), x1=Math.max(p[0],q[0]), y0=Math.min(p[1],q[1]), y1=Math.max(p[1],q[1]);
  for(const r of boxes) if(x0<r.x1-pad&&x1>r.x0+pad&&y0<r.y1-pad&&y1>r.y0+pad) n++;
  return n;
}
/* The best right-angled route between two shapes (or loose ends): every pair of sides, joined directly, with one
   turn, or with two turns along a channel beside the shapes in the way. A route is scored on length, turns, and
   above all on not passing through other shapes or back through its own two. */
function autoRoute(bTo,eTo,b,e){
  const A=boxOf(bTo,b), B=boxOf(eTo,e), skip=[bTo,eTo].filter(Boolean), boxes=obstacles(skip);
  const sides=(id,r,p)=>{ if(!id) return [{p,out:p}];
    const cx=(r.x0+r.x1)/2, cy=(r.y0+r.y1)/2;
    return [[[r.x0,cy],[-1,0]],[[r.x1,cy],[1,0]],[[cx,r.y0],[0,-1]],[[cx,r.y1],[0,1]]]
      .map(([q,d])=>{ const out=[q[0]+d[0]*STUB,q[1]+d[1]*STUB]; return {p:landOn(id,out),out}; }); };
  const lo=[Math.min(A.x0,B.x0)-200,Math.min(A.y0,B.y0)-200], hi=[Math.max(A.x1,B.x1)+200,Math.max(A.y1,B.y1)+200];
  const near=[...boxes.filter(r=>r.x1>lo[0]&&r.x0<hi[0]&&r.y1>lo[1]&&r.y0<hi[1]),...(bTo?[A]:[]),...(eTo?[B]:[])];
  const xs=near.flatMap(r=>[r.x0-CLEAR,r.x1+CLEAR]), ys=near.flatMap(r=>[r.y0-CLEAR,r.y1+CLEAR]);
  const own=[...(bTo?[A]:[]),...(eTo?[B]:[])];
  let best=null, bestScore=Infinity;
  for(const sa of sides(bTo,A,b)) for(const sb of sides(eTo,B,e)){
    const p=sa.out, q=sb.out, mids=[[]];
    if(!level(p,q)) mids.push([[q[0],p[1]]],[[p[0],q[1]]]);
    for(const x of [(p[0]+q[0])/2,...xs]) mids.push([[x,p[1]],[x,q[1]]]);
    for(const y of [(p[1]+q[1])/2,...ys]) mids.push([[p[0],y],[q[0],y]]);
    for(const m of mids){
      const pts=simplify([sa.p,p,...m,q,sb.p]);
      if(!pts.slice(1).every((c,i)=>level(c,pts[i]))) continue;   // only right angles
      let len=0, hit=0, back=0;
      for(let i=1;i<pts.length;i++){ const s0=pts[i-1], s1=pts[i];
        len+=Math.abs(s1[0]-s0[0])+Math.abs(s1[1]-s0[1]); hit+=crossings(s0,s1,boxes);
        if(i>1&&i<pts.length-1) back+=crossings(s0,s1,own,1); }
      const score=len+25*(pts.length-2)+2000*hit+3000*back;
      if(score<bestScore){ bestScore=score; best=pts; }
    }
  }
  return best||[b,e];
}
