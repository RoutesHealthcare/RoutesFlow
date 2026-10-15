/* ---------- properties panel ---------- */
import {$, MM, S, colour, kid, kids, setCell} from './core.js';
import {cellV, is1D, num, setText, shapeCtx, shapeText} from './visio-package.js';
import {canResize, pageCtx, render} from './render.js';
import {refreshFor} from './connectors.js';
import {applySize, isTable, resizeTable, roleOf} from './shapes.js';
import {deleteShapes, selEls, selIds} from './selection.js';
import {plural} from './formats/export.js';
import {LINE_TEXT_PT, resolveType, setTextPt, SHAPE_TEXT_PT, textPt, userV} from './flow/model.js';
import {commit} from './document.js';
import {openAny} from './visio-io.js';
import {moveStatement, updateConnProps} from './connection-props.js';
import {TP, curLineFor, paintCode} from './text-pane.js';

export function updateProps(){
  const pg=pageCtx(), el=S.sel&&S.elById[S.sel];
  $('propsEmpty').hidden=!!el; $('propsShape').hidden=!el;
  if(!el){
    if(pg){ const n=kids(kid(pg.doc.documentElement,'Shapes'),'Shape').filter(x=>!is1D(shapeCtx(x,null))&&roleOf(x)!=='key').length;
      $('pageInfo').textContent=`${pg.name}, ${Math.round(pg.w*25.4)} × ${Math.round(pg.h*25.4)} mm, ${plural(n,'shape')}.`; }
    const ap=S.ast&&S.ast.pages[S.pi]; $('pAddKey').textContent=ap&&ap.key?'Remove the key':'Add a key to this page';
    $('pNewConn').value=resolveType(S.newConn);
    if(TP.open&&TP.mode==='flow'&&TP.cur!==-1){ TP.cur=-1; paintCode(); }
    return;
  }
  const sh=shapeCtx(el,null), oneD=is1D(sh), table=isTable(el), key=roleOf(el)==='key', fid=userV(el,'FlowId');
  $('selTitle').textContent=key?'Key':oneD?'Connection':`${table?'Table':'Shape'} ${fid||''}`;
  if(document.activeElement!==$('pText')) $('pText').value=shapeText(sh);
  $('pFill').value=colour(cellV(sh,'FillForegnd',null),'#FFFFFF').toLowerCase();
  $('pLine').value=colour(cellV(sh,'LineColor',null),'#000000').toLowerCase();
  const pt=num(sh,'LineWeight',0.01)*72, opts=[...$('pWeight').options].map(o=>+o.value);
  $('pWeight').value=String(opts.reduce((x,y)=>Math.abs(y-pt)<Math.abs(x-pt)?y:x));
  for(const w of ['textWrap','lineWrap','weightWrap']) $(w).hidden=table||key;
  $('sizeWrap').hidden=table||key; showSize([el]);
  $('tableBtns').hidden=$('tableHint').hidden=!table;
  $('editHint').hidden=table||key;
  $('fillWrap').hidden=oneD||table||key; $('connBox').hidden=!oneD; $('sizeRow').hidden=!canResize(el)||key;
  $('pW').value=Math.round(num(sh,'Width',0)*25.4); $('pH').value=Math.round(num(sh,'Height',0)*25.4);
  $('orderBtns').hidden=oneD;
  $('pDelete').textContent=key?'Remove the key':oneD?'Delete connection':'Delete shape';
  if(oneD) updateConnProps(el);
  if(TP.open&&TP.mode==='flow'){ const c=curLineFor(); if(c!==TP.cur){ TP.cur=c; paintCode(); } }
  if(S.selection.size>1) showMultiProps();
}
export const selEl=()=>S.sel&&S.elById[S.sel];
/* Shown in place of the single-shape fields when more than one object is selected */
function showMultiProps(){
  const els=selEls();
  $('selTitle').textContent=`${els.length} items selected`;
  for(const w of ['textWrap','editHint','sizeRow','connBox','tableBtns','tableHint','orderBtns']) $(w).hidden=true;
  $('fillWrap').hidden=!els.some(fillable);
  $('lineWrap').hidden=$('weightWrap').hidden=!els.some(styleable);
  $('sizeWrap').hidden=!els.some(styleable); showSize(els.filter(styleable));
  $('pDelete').textContent=`Delete ${els.length} items`;
}
const styleable=el=>roleOf(el)!=='key'&&!isTable(el);
const fillable=el=>styleable(el)&&!is1D(shapeCtx(el,null));
function styleSelection(filter,apply){ const els=selEls().filter(filter); if(els.length) commit(()=>els.forEach(apply)); }
function sizeFromProps(){
  const el=selEl(); if(!el) return; const sh=shapeCtx(el,null);
  const W=Math.max(3,+$('pW').value||0)*MM, H=Math.max(3,+$('pH').value||0)*MM;
  const W0=num(sh,'Width',1), H0=num(sh,'Height',1);
  commit(()=>{ applySize(el,W,H,W0,H0,num(sh,'LocPinX',W0/2),num(sh,'LocPinY',H0/2)); render(); refreshFor(S.sel); });
}
export function downloadBlob(blob,name){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1500);
}

const TEXT_SIZES=[6,7,8,9,10,11,12,14,16,18,20,24,28,36,48];
/* Shows the text size of the selection, or nothing when the selected items differ */
function showSize(els){
  const pts=[...new Set(els.map(el=>textPt(shapeCtx(el,null))||(is1D(shapeCtx(el,null))?LINE_TEXT_PT:SHAPE_TEXT_PT)))];
  const sel=$('pSize'); for(const o of [...sel.options]) if(o.dataset.extra) o.remove();
  if(pts.length===1&&!TEXT_SIZES.includes(pts[0])){ const o=new Option(pts[0]+' pt',pts[0]); o.dataset.extra='1'; sel.appendChild(o); }
  sel.value=pts.length===1?String(pts[0]):'';
}

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  for(const pt of TEXT_SIZES) $('pSize').appendChild(new Option(pt+' pt',pt));
  $('pSize').addEventListener('change',()=>{ const v=+$('pSize').value; if(v) styleSelection(styleable,el=>setTextPt(el,v)); });
  $('pFill').addEventListener('change',()=>{ const v=$('pFill').value.toUpperCase();
    styleSelection(fillable,el=>{ setCell(el,'FillForegnd',v); setCell(el,'FillPattern',1); }); });
  $('pLine').addEventListener('change',()=>{ const v=$('pLine').value.toUpperCase();
    styleSelection(styleable,el=>{ setCell(el,'LineColor',v); if(num(shapeCtx(el,null),'LinePattern',1)===0) setCell(el,'LinePattern',1); }); });
  $('pWeight').addEventListener('change',()=>{ const v=+$('pWeight').value;
    styleSelection(styleable,el=>{ if(v===0) setCell(el,'LinePattern',0); else { setCell(el,'LinePattern',1); setCell(el,'LineWeight',v/72); } }); });
  $('pDelete').onclick=()=>deleteShapes(selIds());
  $('pAddRow').onclick=()=>{ if(S.sel) resizeTable(S.sel,true); };
  $('pDelRow').onclick=()=>{ if(S.sel) resizeTable(S.sel,false); };
  $('pText').addEventListener('change',()=>{ const el=selEl(); if(el) commit(()=>setText(el,$('pText').value)); });
  $('pW').addEventListener('change',sizeFromProps); $('pH').addEventListener('change',sizeFromProps);
  $('pFront').onclick=()=>{ const el=selEl(); if(el) moveStatement(el,true); };
  $('pBack').onclick=()=>{ const el=selEl(); if(el) moveStatement(el,false); };

  /* ---------- open / save: see the flow module ---------- */
  $('fileInput').addEventListener('change',async e=>{ const f=e.target.files[0]; e.target.value=''; if(f) await openAny(f,null); });
}
