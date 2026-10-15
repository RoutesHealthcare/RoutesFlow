/* ---------- connectors and glue ---------- */
import {NS, PX, S, WALK, cellEl, delCell, insertSection, kid, kids, mk, setCell} from './core.js';
import {num, shapeCtx} from './visio-package.js';
import {pageCtx} from './render.js';

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
export function setConnector(el,b,e,bTo,eTo){
  const doc=el.ownerDocument, L=Math.hypot(e[0]-b[0],e[1]-b[1]), ang=Math.atan2(e[1]-b[1],e[0]-b[0]);
  if(bTo||eTo){
    setCell(el,'BegTrigger',bTo?2:0,bTo?`_XFTRIGGER(Sheet.${bTo}!EventXFMod)`:undefined);
    setCell(el,'EndTrigger',eTo?2:0,eTo?`_XFTRIGGER(Sheet.${eTo}!EventXFMod)`:undefined);
  } else { delCell(el,'BegTrigger'); delCell(el,'EndTrigger'); }
  setCell(el,'BeginX',b[0],bTo?WALK:undefined); setCell(el,'BeginY',b[1],bTo?WALK:undefined);
  setCell(el,'EndX',e[0],eTo?WALK:undefined); setCell(el,'EndY',e[1],eTo?WALK:undefined);
  setCell(el,'PinX',(b[0]+e[0])/2,'GUARD((BeginX+EndX)/2)'); setCell(el,'PinY',(b[1]+e[1])/2,'GUARD((BeginY+EndY)/2)');
  setCell(el,'Width',L,'GUARD(SQRT((EndX-BeginX)^2+(EndY-BeginY)^2))'); setCell(el,'Height',0);
  setCell(el,'Angle',ang,'GUARD(ATAN2(EndY-BeginY,EndX-BeginX))');
  setCell(el,'LocPinX',L/2,'GUARD(Width*0.5)'); setCell(el,'LocPinY',0,'GUARD(Height*0.5)');
  setCell(el,'FlipX',0); setCell(el,'FlipY',0);
  for(const s of kids(el,'Section')) if(s.getAttribute('N')==='Geometry') s.remove();
  const sec=mk(doc,'Section',{N:'Geometry',IX:'0'},[cellEl(doc,'NoFill',1),cellEl(doc,'NoLine',0),cellEl(doc,'NoShow',0),
    mk(doc,'Row',{T:'MoveTo',IX:'1'},[cellEl(doc,'X',0,'Width*0'),cellEl(doc,'Y',0,'Height*0.5')]),
    mk(doc,'Row',{T:'LineTo',IX:'2'},[cellEl(doc,'X',L,'Width*1'),cellEl(doc,'Y',0,'Height*0.5')])]);
  const sh=shapeCtx(el,null);
  if(sh.mel) for(const ms of kids(sh.mel,'Section')) if(ms.getAttribute('N')==='Geometry'){
    const ix=ms.getAttribute('IX')||'0';
    if(ix==='0'){ for(const r of kids(ms,'Row')){ const rix=r.getAttribute('IX'); if(+rix>2) sec.appendChild(mk(doc,'Row',{T:r.getAttribute('T'),IX:rix,Del:'1'})); } }
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
  const bc=bTo?centreOf(bTo):b, ec=eTo?centreOf(eTo):e;
  if(bTo) b=anchorFor(bTo,ec); if(eTo) e=anchorFor(eTo,bc);
  setConnector(el,toIn(b),toIn(e),bTo,eTo);
}
export function refreshForMany(ids){
  const moved=new Set();
  for(const id of ids){ const el=S.elById[id]; if(!el) continue; moved.add(id);
    for(const s of el.getElementsByTagNameNS(NS,'Shape')) moved.add(s.getAttribute('ID')); }
  for(const c of new Set(listConnects().filter(c=>moved.has(c.to)).map(c=>c.from))) refreshConnector(c);
}
export const refreshFor=id=>refreshForMany([id]);
