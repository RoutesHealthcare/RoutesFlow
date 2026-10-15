/* ---------- pointer interaction ---------- */
import {$, PX, S, setCell, snapIn, stage, svg, svgEl, toast} from './core.js';
import {is1D, num, shapeCtx} from './visio-package.js';
import {applyView, drawOverlay, pageCtx, render, zoomAt} from './render.js';
import {centreOf, refreshConnector, refreshFor, refreshForMany, setGlue} from './connectors.js';
import {addConnector, applySize, roleOf} from './shapes.js';
import {HIT_TOL_PX, isConnector, selIds, select, toggleSelection, topLevelIds} from './selection.js';
import {commitText, editText} from './text-editor.js';
import {updateProps} from './properties.js';
import {commit, pushUndo, rebuild, selMemo, snapshot} from './document.js';

let drag=null;
export function toPage(e){ const r=svg.getBoundingClientRect(), pg=pageCtx(); const px=(e.clientX-r.left-S.panX)/S.zoom, py=(e.clientY-r.top-S.panY)/S.zoom; return {px,py,x:px/PX,y:pg.h-py/PX}; }
function hitShape(e,exclude){
  for(const n of document.elementsFromPoint(e.clientX,e.clientY)){
    const g=n.closest&&n.closest('#layer [data-id]');
    if(g&&g.dataset.id!==exclude&&!is1D(shapeCtx(S.elById[g.dataset.id],null))&&roleOf(S.elById[g.dataset.id])!=='key') return g.dataset.id;
  }
  return null;
}
/* ---------- hit testing ---------- */
function distToLines(segs,x,y){
  let best=Infinity;
  for(const s of segs||[]) for(let i=1;i<s.length;i++){
    const [ax,ay]=s[i-1], [bx,by]=s[i], dx=bx-ax, dy=by-ay, L=dx*dx+dy*dy;
    const t=L?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/L)):0;
    best=Math.min(best,Math.hypot(x-ax-t*dx,y-ay-t*dy));
  }
  return best;
}
/* Every top-level object under the pointer, best first: a connection the pointer is on, then shapes the
   pointer is inside (smallest first, so small shapes are not hidden by large ones), then shapes the
   pointer is only near. */
function stackAt(e){
  const pt=toPage(e), tol=HIT_TOL_PX/S.zoom, seen=new Set(), hits=[];
  for(const n of document.elementsFromPoint(e.clientX,e.clientY)){
    const g=n.closest&&n.closest('#layer > [data-id]'); if(!g) continue;
    const id=g.dataset.id; if(seen.has(id)||!S.elById[id]) continue; seen.add(id);
    let rank, area=0;
    if(isConnector(id)){
      if(!n.closest('text')&&distToLines(S.lines[id],pt.px,pt.py)>tol) continue;
      rank=0;
    } else {
      const b=S.boxes[id]; if(!b) continue;
      rank=pt.px>=b.x0&&pt.px<=b.x1&&pt.py>=b.y0&&pt.py<=b.y1?1:2; area=(b.x1-b.x0)*(b.y1-b.y0);
    }
    hits.push({id,rank,area,z:hits.length});
  }
  return hits.sort((a,b)=>a.rank-b.rank||a.area-b.area||a.z-b.z).map(h=>h.id);
}
/* With Alt held, a selected object under the pointer keeps priority, so a covered shape can be dragged */
const pickFrom=(stack,alt)=>(alt&&stack.includes(S.sel)?S.sel:stack[0])??null;

/* ---------- hover feedback ---------- */
let hoverLayer;
let hoverEvt=null, hoverRaf=0;
function setHover(id){ if(S.hover===id) return; S.hover=id; drawHover(); }
export function drawHover(){
  hoverLayer.replaceChildren();
  const id=S.hover&&S.elById[S.hover]?S.hover:null, line=!!id&&isConnector(id);
  stage.classList.toggle('over-shape',!!id&&!line); stage.classList.toggle('over-line',line);
  if(!id||S.selection.has(id)) return;
  if(line){ for(const s of S.lines[id]||[]) hoverLayer.appendChild(svgEl('path',{d:'M'+s.map(q=>q[0].toFixed(2)+' '+q[1].toFixed(2)).join('L'),class:'hoverline'})); return; }
  const b=S.boxes[id];
  if(b) hoverLayer.appendChild(svgEl('rect',{x:b.x0,y:b.y0,width:Math.max(b.x1-b.x0,0.5),height:Math.max(b.y1-b.y0,0.5),class:'hoverbox'}));
}

/* ---------- marquee and multi-move ---------- */
function updateMarquee(d,p){
  const r={x0:Math.min(d.p0.px,p.px),y0:Math.min(d.p0.py,p.py),x1:Math.max(d.p0.px,p.px),y1:Math.max(d.p0.py,p.py)};
  const inside=topLevelIds().filter(id=>{ const b=S.boxes[id]; return b&&b.x0>=r.x0&&b.x1<=r.x1&&b.y0>=r.y0&&b.y1<=r.y1; });
  const ids=d.add?[...new Set([...d.base,...inside])]:inside;
  S.selection=new Set(ids); S.sel=ids.includes(S.sel)?S.sel:(ids[0]??null);
  drawOverlay();
  $('overlay').appendChild(svgEl('rect',{x:r.x0,y:r.y0,width:r.x1-r.x0,height:r.y1-r.y0,class:'marquee'}));
}
/* Snaps the lead shape to the grid and moves the rest by the same amount, so their spacing is kept */
function moveDrag(d,dx,dy,free){
  const lead=shapeCtx(d.orig.get(d.lead),null), W=num(lead,'Width',0), H=num(lead,'Height',0);
  const left=num(lead,'PinX',0)-num(lead,'LocPinX',W/2), bottom=num(lead,'PinY',0)-num(lead,'LocPinY',H/2);
  let L=left+dx, B=bottom+dy; if(!free){ L=snapIn(L); B=snapIn(B); }
  for(const [id,orig] of d.orig){ const el=S.elById[id], o=shapeCtx(orig,null); if(!el) continue;
    setCell(el,'PinX',num(o,'PinX',0)+L-left); setCell(el,'PinY',num(o,'PinY',0)+B-bottom); }
  render(); refreshForMany(d.ids); render();
}

/* ---------- pointer interaction ---------- */
let spaceHeld=false;
export function setSpaceHeld(v){ spaceHeld=v; stage.classList.toggle('panning',v); }

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  hoverLayer=svgEl('g',{id:'hover'}); $('view').insertBefore(hoverLayer,$('overlay'));
  svg.addEventListener('pointermove',e=>{
    if(drag) return; hoverEvt=e;
    if(!hoverRaf) hoverRaf=requestAnimationFrame(()=>{ hoverRaf=0; if(!drag&&hoverEvt) setHover(pickFrom(stackAt(hoverEvt),hoverEvt.altKey)); });
  });
  svg.addEventListener('pointerleave',()=>setHover(null));
  svg.addEventListener('pointerdown',e=>{
    if(S.editing) commitText();
    if(e.button!==0&&e.button!==1) return;
    setHover(null);
    const p=toPage(e), hEl=e.target.closest('[data-handle]'), additive=e.shiftKey||e.ctrlKey||e.metaKey;
    const stack=hEl?[]:stackAt(e), pick=pickFrom(stack,e.altKey);
    const pan=()=>({kind:'pan',cx:e.clientX,cy:e.clientY,px:S.panX,py:S.panY});
    if(e.button===1||spaceHeld) drag=pan();
    else if(hEl&&S.selection.size===1){
      const h=hEl.dataset.handle;
      drag={kind:h.length>2?'end':'resize',h,id:S.sel,orig:S.elById[S.sel].cloneNode(true),snap:snapshot(),p0:p,moved:false};
    } else if(S.tool==='connect'){
      if(!pick){ select(null); drag=pan(); }
      else if(isConnector(pick)) return;
      else drag={kind:'connect',from:pick,p0:p,moved:false};
    } else if(!pick){
      if(!additive) select(null);
      drag={kind:'marquee',p0:p,add:additive,base:new Set(S.selection),moved:false};
    } else if(additive){ toggleSelection(pick); return; }
    else {
      const wasSelected=S.selection.has(pick), prev=S.sel;
      if(wasSelected){ S.sel=pick; drawOverlay(); updateProps(); } else select(pick);
      const ids=selIds().filter(id=>!isConnector(id));   // connections follow their shapes; they are not dragged on their own
      const again=wasSelected&&S.selection.size===1;   // a second click on the only selected object edits its text
      const base={pick,prev,stack,alt:e.altKey,again,collapse:wasSelected&&S.selection.size>1,p0:p,moved:false};
      drag=ids.length?{...base,kind:'move',ids,lead:ids.includes(pick)?pick:ids[0],
        orig:new Map(ids.map(id=>[id,S.elById[id].cloneNode(true)])),snap:snapshot()}:{...base,kind:'click'};
    }
    svg.setPointerCapture(e.pointerId); e.preventDefault();
  });
  svg.addEventListener('pointermove',e=>{
    if(!drag) return;
    if(drag.kind==='pan'){ S.panX=drag.px+e.clientX-drag.cx; S.panY=drag.py+e.clientY-drag.cy; applyView(); return; }
    const p=toPage(e), dx=p.x-drag.p0.x, dy=p.y-drag.p0.y;
    if(!drag.moved&&Math.hypot(dx,dy)*PX*S.zoom<3) return;
    drag.moved=true;
    if(drag.kind==='click') return;
    if(drag.kind==='marquee'){ updateMarquee(drag,p); return; }
    if(drag.kind==='move'){ moveDrag(drag,dx,dy,e.altKey); return; }
    if(drag.kind==='connect'){
      drawOverlay(); const c=centreOf(drag.from);
      $('overlay').appendChild(svgEl('line',{x1:c[0],y1:c[1],x2:p.px,y2:p.py,class:'ghost'})); return;
    }
    const el=S.elById[drag.id], o=shapeCtx(drag.orig,null);
    if(drag.kind==='resize'){
      const fresh=drag.orig.cloneNode(true); el.parentNode.replaceChild(fresh,el); S.elById[drag.id]=fresh;
      const W0=num(o,'Width',1), H0=num(o,'Height',1), lx=num(o,'LocPinX',W0/2), ly=num(o,'LocPinY',H0/2);
      let L=num(o,'PinX',0)-lx, B=num(o,'PinY',0)-ly, R=L+W0, T=B+H0; const min=0.1;
      const x=e.altKey?p.x:snapIn(p.x), y=e.altKey?p.y:snapIn(p.y), h=drag.h;
      if(h.includes('w')) L=Math.min(x,R-min); if(h.includes('e')) R=Math.max(x,L+min);
      if(h.includes('n')) T=Math.max(y,B+min); if(h.includes('s')) B=Math.min(y,T-min);
      applySize(fresh,R-L,T-B,W0,H0,lx,ly);
      setCell(fresh,'PinX',L+lx/W0*(R-L)); setCell(fresh,'PinY',B+ly/H0*(T-B));
      render(); refreshFor(drag.id);
    } else if(drag.kind==='end'){
      const end=drag.h==='begin'?'Begin':'End';
      if(!drag.unglued){ setGlue(drag.id,end,null); drag.unglued=true; }
      setCell(el,end+'X',p.x); setCell(el,end+'Y',p.y);
      render(); refreshConnector(drag.id);
    }
    render();
  });
  svg.addEventListener('pointerup',e=>{
    if(!drag) return; const d=drag; drag=null;
    if(svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    if(d.kind==='marquee'){ if(d.moved){ drawOverlay(); updateProps(); } return; }
    if((d.kind==='move'||d.kind==='click')&&!d.moved){
      if(d.alt&&d.stack.length>1){ const next=d.stack[(d.stack.indexOf(d.prev)+1)%d.stack.length]; select(next); }   // Alt+click: the object underneath
      else if(d.collapse) select(d.pick);   // a plain click inside a multi-selection keeps only that object
      else if(d.again&&!d.alt) editText(d.pick,undefined,toPage(e));
      return;
    }
    if(d.kind==='connect'){
      drawOverlay(); if(!d.moved) return;
      const p=toPage(e), tgt=hitShape(e,d.from);
      if(!tgt){ toast('Drop the end of the connection on a shape.'); return; }
      commit(()=>{ S.sel=addConnector(d.from,tgt,[p.x,p.y]); });
      return;
    }
    if(d.kind==='end'&&d.moved){
      const tgt=hitShape(e,d.id);
      if(!tgt){ toast('Both ends of a connection need to be on a shape.'); rebuild(selMemo()); return; }
      setGlue(d.id,d.h==='begin'?'Begin':'End',tgt); render(); refreshConnector(d.id);
    }
    if(d.moved&&d.snap){ pushUndo(d.snap); render(); }
  });
  /* A cancelled gesture (a touch taken over by the system, say) puts the drawing back as the text has it */
  svg.addEventListener('pointercancel',()=>{
    const d=drag; drag=null; if(!d) return;
    if(d.moved&&d.snap){ console.warn('Pointer gesture cancelled; reverting',d.kind); rebuild(selMemo()); } else drawOverlay();
  });
  svg.addEventListener('dblclick',e=>{
    const st=stackAt(e), id=st.includes(S.sel)?S.sel:st[0]; if(!id) return;
    select(id); editText(id,undefined,toPage(e));
  });
  stage.addEventListener('wheel',e=>{
    e.preventDefault(); const r=svg.getBoundingClientRect();
    if(e.ctrlKey||e.metaKey) zoomAt(Math.exp(-e.deltaY*0.0015),e.clientX-r.left,e.clientY-r.top);
    else { if(S.editing) commitText(); S.panX-=e.deltaX; S.panY-=e.deltaY; applyView(); }
  },{passive:false});
}
