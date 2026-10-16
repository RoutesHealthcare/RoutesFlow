/* ---------- selection ----------
   S.selection holds every selected top-level shape ID. S.sel is the primary one: the shape the
   properties panel shows and the one text editing and resize handles act on. Code that still
   assigns S.sel directly keeps working, because render() calls syncSelection(). */
import {MM, NS, S, kid, kids, setCell, toast} from './core.js';
import {is1D, num, shapeCtx} from './visio-package.js';
import {drawOverlay, pageCtx, render} from './render.js';
import {connectsEl, listConnects, refreshConnector, refreshForMany, setGlue} from './connectors.js';
import {nextId, roleOf} from './shapes.js';
import {drawHover} from './pointer.js';
import {updateProps} from './properties.js';
import {delUser, userV} from './flow/model.js';
import {commit} from './document.js';
import {plural} from './formats/export.js';

export const HIT_TOL_PX=6;   // screen pixels: how close the pointer must be to a connection's line to pick it
export const HIT_PAD_PX=5;   // screen pixels: extra margin around every shape that still counts as a hit
export const isConnector=id=>{ const el=S.elById[id]; return !!el&&is1D(shapeCtx(el,null)); };
export const selIds=()=>[...S.selection];
export const selEls=()=>selIds().map(id=>S.elById[id]).filter(Boolean);
export const topLevelIds=()=>{ const pg=pageCtx(); return pg?kids(kid(pg.doc.documentElement,'Shapes'),'Shape').map(el=>el.getAttribute('ID')):[]; };
function setSelection(ids,primary){
  S.selection=new Set(ids.filter(id=>S.elById[id]));
  S.sel=primary!=null&&S.selection.has(primary)?primary:(selIds()[0]??null);
  drawOverlay(); updateProps(); drawHover();
}
export function syncSelection(){
  if(S.sel==null){ S.selection=new Set(); return; }
  const live=selIds().filter(id=>S.elById[id]);
  if(!S.elById[S.sel]) S.sel=live[0]??null;
  S.selection=S.sel==null?new Set():S.selection.has(S.sel)?new Set(live):new Set([S.sel]);
}
export function select(id){ setSelection(id?[id]:[],id); }
export function toggleSelection(id){
  if(S.selection.has(id)) setSelection(selIds().filter(i=>i!==id),S.sel===id?null:S.sel);
  else setSelection([...selIds(),id],id);
}
export const selectAll=()=>setSelection(topLevelIds(),S.sel);

export function deleteShapes(idList){
  const targets=idList.filter(id=>S.elById[id]); if(!targets.length) return;
  commit(()=>{
    const doc=pageCtx().doc, gone=new Set();
    for(const id of targets){ gone.add(id); for(const s of S.elById[id].getElementsByTagNameNS(NS,'Shape')) gone.add(s.getAttribute('ID')); }
    const affected=new Set(), ce=connectsEl(doc,false);
    if(ce){ for(const c of kids(ce,'Connect')){ const f=c.getAttribute('FromSheet'), t=c.getAttribute('ToSheet');
        if(gone.has(f)) c.remove(); else if(gone.has(t)){ c.remove(); affected.add(f); } }
      if(!kids(ce,'Connect').length) ce.remove(); }
    for(const id of targets){
      const el=S.elById[id], parent=el.parentNode; el.remove();
      if(parent&&parent.localName==='Shapes'&&!kids(parent,'Shape').length&&parent.parentNode===doc.documentElement) parent.remove();
    }
    S.sel=null; S.selection=new Set(); render();
    for(const a of affected) if(!gone.has(a)) refreshConnector(a);
  });
}
const deleteShape=id=>deleteShapes([id]);

export function moveMany(ids,dx,dy){
  const movable=ids.filter(id=>S.elById[id]&&!isConnector(id));   // connections follow their shapes
  for(const id of movable){ const el=S.elById[id], sh=shapeCtx(el,null);
    setCell(el,'PinX',num(sh,'PinX',0)+dx); setCell(el,'PinY',num(sh,'PinY',0)+dy); }
  if(movable.length){ render(); refreshForMany(movable,{dx,dy}); }
}
const moveBy=(id,dx,dy)=>moveMany([id],dx,dy);

function cloneShape(el,doc,dx,dy){
  const c=el.cloneNode(true), nid=nextId(doc), sh=shapeCtx(el,null);
  c.setAttribute('ID',nid);
  for(const a of ['Name','NameU','IsCustomName','IsCustomNameU','UniqueID']) c.removeAttribute(a);
  delUser(c,'FlowId'); delUser(c,'FlowEdge');   // the copy gets its own name or line when it is written to the text
  el.parentNode.appendChild(c);
  if(dx||dy){ setCell(c,'PinX',num(sh,'PinX',0)+dx); setCell(c,'PinY',num(sh,'PinY',0)+dy); }
  return nid;
}
const copyableIds=ids=>ids.filter(id=>{ const el=S.elById[id]; return el&&el.getAttribute('Type')!=='Group'&&!isConnector(id)&&roleOf(el)!=='key'; });
/* Clones shapeIds by dx,dy (page inches), and any of lineIds whose two ends are both among them. Must run
   inside a commit(). Returns the new ids, lead shape first. */
function cloneGroup(shapeIds,lineIds,dx,dy){
  const doc=pageCtx().doc, copyOf=new Map();
  for(const id of shapeIds) copyOf.set(id,cloneShape(S.elById[id],doc,dx,dy));
  render();   // the copies need boxes before connections can be attached to them
  const cons=listConnects(), endOf=(id,cell)=>(cons.find(c=>c.from===id&&c.fromCell===cell)||{}).to;
  const lineCopies=lineIds.filter(id=>copyOf.has(endOf(id,'BeginX'))&&copyOf.has(endOf(id,'EndX')))
    .map(id=>[id,cloneShape(S.elById[id],doc,0,0)]);
  for(const [id,nid] of lineCopies){
    setGlue(nid,'Begin',copyOf.get(endOf(id,'BeginX'))); setGlue(nid,'End',copyOf.get(endOf(id,'EndX'))); refreshConnector(nid);
  }
  return [...copyOf.values(),...lineCopies.map(x=>x[1])];
}
/* Copies the selected shapes, and any selected connections whose two ends are both on copied shapes */
export function duplicate(){
  const ids=selIds(); if(!ids.length) return;
  const shapes=copyableIds(ids);
  if(!shapes.length){ toast('Duplicate works on single shapes, not groups, connections or the key.'); return; }
  commit(()=>{ const copies=cloneGroup(shapes,ids.filter(isConnector),5*MM,-5*MM); S.sel=copies[0]; S.selection=new Set(copies); });
}

/* ---------- copy / paste ----------
   The clipboard holds FlowIds (the stable, named .flow identifiers), not raw element ids — raw ids are
   reassigned on every rebuild, so they would not survive so much as one other edit between copy and
   paste. Which connections to bring along is re-resolved at paste time too, from whatever currently
   connects the copied shapes to each other — so an edit to that connection before pasting is reflected,
   same as the shapes themselves. It only works back onto the page it was copied from. */
let clipboard=null;
const findByFid=fid=>kids(kid(pageCtx().doc.documentElement,'Shapes'),'Shape').find(el=>userV(el,'FlowId')===fid)||null;
export function copySelection(){
  const shapeIds=copyableIds(selIds());
  if(!shapeIds.length){ toast('Copy works on single shapes, not groups, connections or the key.'); return; }
  const fids=shapeIds.map(id=>userV(S.elById[id],'FlowId')).filter(Boolean);
  clipboard={fids,pastes:0,page:S.pi};
  toast(`Copied ${plural(fids.length,'shape')}.`);
}
export function pasteClipboard(){
  if(!clipboard) return;
  if(clipboard.page!==S.pi){ toast('Switch back to the page you copied from to paste.'); return; }
  const shapes=clipboard.fids.map(findByFid).filter(Boolean).map(el=>el.getAttribute('ID'));
  if(!shapes.length){ toast('Nothing to paste — the copied shapes no longer exist.'); clipboard=null; return; }
  const shapeSet=new Set(shapes), cons=listConnects();
  const lines=[...new Set(cons.map(c=>c.from))].filter(cid=>{
    const ends=cons.filter(c=>c.from===cid);
    return ends.length===2&&ends.every(c=>shapeSet.has(c.to));
  });
  clipboard.pastes++;
  const off=5*MM*clipboard.pastes;
  commit(()=>{ const copies=cloneGroup(shapes,lines,off,-off); S.sel=copies[0]; S.selection=new Set(copies); });
}

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  S.selection=new Set(); S.hover=null; S.lines={};
}
