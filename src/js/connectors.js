/* ---------- connectors and glue ---------- */
import {NS, PX, S, WALK, cellEl, delCell, insertSection, kid, kids, mk, setCell} from './core.js';
import {num, shapeCtx} from './visio-package.js';
import {pageCtx} from './render.js';
import {delUser, parseVia, userV} from './flow/model.js';

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
export function refreshConnector(cid){
  const pg=pageCtx(), el=S.elById[cid];
  if(!el||el.parentNode!==kid(pg.doc.documentElement,'Shapes')) return;
  const sh=shapeCtx(el,null), toPx=(x,y)=>[x*PX,(pg.h-y)*PX], toIn=q=>[q[0]/PX,pg.h-q[1]/PX];
  const cons=listConnects().filter(c=>c.from===cid);
  let bTo=(cons.find(c=>c.fromCell==='BeginX')||{}).to||null, eTo=(cons.find(c=>c.fromCell==='EndX')||{}).to||null;
  if(bTo&&!S.boxes[bTo]) bTo=null; if(eTo&&!S.boxes[eTo]) eTo=null;
  let b=toPx(num(sh,'BeginX',0),num(sh,'BeginY',0)), e=toPx(num(sh,'EndX',0),num(sh,'EndY',0));
  if(userV(el,'FlowRoute')==='elbow'){
    const pts=elbowRoute(bTo,eTo,b,e,(parseVia(userV(el,'FlowVia'))||[]).map(([x,y])=>[x/25.4*PX,y/25.4*PX]));
    setConnector(el,toIn(pts[0]),toIn(pts[pts.length-1]),bTo,eTo,pts.slice(1,-1).map(toIn));
    return;
  }
  const bc=bTo?centreOf(bTo):b, ec=eTo?centreOf(eTo):e;
  if(bTo) b=anchorFor(bTo,ec); if(eTo) e=anchorFor(eTo,bc);
  setConnector(el,toIn(b),toIn(e),bTo,eTo);
}

/* ---------- right-angled routing (page pixels) ---------- */
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
/* Every point of a right-angled line, begin and end included. With bend points (kept from a Visio import) the
   line runs through them; otherwise it leaves from the sides that face each other and turns halfway. */
function elbowRoute(bTo,eTo,b,e,via){
  if(via.length) return [bTo?landOn(bTo,via[0]):b,...via,eTo?landOn(eTo,via[via.length-1]):e];
  const A=boxOf(bTo,b), B=boxOf(eTo,e), ca=bTo?centreOf(bTo):b, cb=eTo?centreOf(eTo):e;
  const gapX=Math.max(B.x0-A.x1,A.x0-B.x1), gapY=Math.max(B.y0-A.y1,A.y0-B.y1);
  if(gapX<=0&&gapY<=0) return [bTo?anchorFor(bTo,cb):b,eTo?anchorFor(eTo,ca):e];   // overlapping shapes: no room to bend
  const side=(id,p,toward)=>id?landOn(id,toward):p;
  if(gapX>=gapY){
    const lo=Math.max(A.y0,B.y0), hi=Math.min(A.y1,B.y1);
    if(lo<=hi){ const y=(Math.max(lo,Math.min(hi,ca[1]))+Math.max(lo,Math.min(hi,cb[1])))/2;   // level with each other: one straight run
      return [side(bTo,b,[cb[0],y]),side(eTo,e,[ca[0],y])]; }
    const x=(B.x0>A.x1?A.x1+B.x0:A.x0+B.x1)/2;
    return [side(bTo,b,[x,ca[1]]),[x,ca[1]],[x,cb[1]],side(eTo,e,[x,cb[1]])];
  }
  const lo=Math.max(A.x0,B.x0), hi=Math.min(A.x1,B.x1);
  if(lo<=hi){ const x=(Math.max(lo,Math.min(hi,ca[0]))+Math.max(lo,Math.min(hi,cb[0])))/2;
    return [side(bTo,b,[x,cb[1]]),side(eTo,e,[x,ca[1]])]; }
  const y=(B.y0>A.y1?A.y1+B.y0:A.y0+B.y1)/2;
  return [side(bTo,b,[ca[0],y]),[ca[0],y],[cb[0],y],side(eTo,e,[cb[0],y])];
}
/* Bend points from an import only fit the shapes where they were; once a shape moves the line is re-routed */
export function clearBends(cid){ const el=S.elById[cid]; if(el) delUser(el,'FlowVia'); }
export function refreshForMany(ids){
  const moved=new Set();
  for(const id of ids){ const el=S.elById[id]; if(!el) continue; moved.add(id);
    for(const s of el.getElementsByTagNameNS(NS,'Shape')) moved.add(s.getAttribute('ID')); }
  for(const c of new Set(listConnects().filter(c=>moved.has(c.to)).map(c=>c.from))){ clearBends(c); refreshConnector(c); }
}
export const refreshFor=id=>refreshForMany([id]);
