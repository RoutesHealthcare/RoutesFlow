/* ---------- properties panel ---------- */
import {$, colour, DEF, kid, kids, MM, S, setCell, toast} from './core.js';
import {cellV, is1D, num, rowV, setText, shapeCtx, shapeText} from './visio-package.js';
import {canResize, pageCtx, render} from './render.js';
import {refreshFor} from './connectors.js';
import {applySize, isTable, resizeTable, roleOf} from './shapes.js';
import {deleteShapes, selEls, selIds} from './selection.js';
import {plural} from './formats/export.js';
import {LINE_TEXT_PT, resolveType, setTextColour, setTextPt, SHAPE_TEXT_PT, textPt, userV} from './flow/model.js';
import {commit} from './document.js';
import {deletePage, fitPageToContent, openAny, pageSizeMM, renamePage, setPageSize} from './visio-io.js';
import {moveStatement, updateConnProps} from './connection-props.js';
import {TP, curLineFor, paintCode} from './text-pane.js';

const PAGE_PRESETS={
  a1p:[594,841],a1l:[841,594],a2p:[420,594],a2l:[594,420],a3p:[297,420],a3l:[420,297],
  a4p:[210,297],a4l:[297,210],a5p:[148,210],a5l:[210,148],letterp:[216,279],letterl:[279,216],
};

export function updateProps(){
  const pg=pageCtx(), el=S.sel&&S.elById[S.sel];
  $('propsEmpty').hidden=!!el; $('propsShape').hidden=!el;
  if(!el){
    if(pg){ const n=kids(kid(pg.doc.documentElement,'Shapes'),'Shape').filter(x=>!is1D(shapeCtx(x,null))&&roleOf(x)!=='key').length;
      const wMM=Math.round(pg.pageW*25.4), hMM=Math.round(pg.pageH*25.4), overflows=pg.w>pg.pageW+1e-6||pg.h>pg.pageH+1e-6;
      $('pageInfo').textContent=`${pg.name}, ${wMM} × ${hMM} mm, ${plural(n,'shape')}.`
        +(overflows?' Shown in grey: content past the page, which a PNG or PDF export would crop.':'');
      if(document.activeElement!==$('pPageName')) $('pPageName').value=pg.name;
      if(document.activeElement!==$('pPageW')) $('pPageW').value=wMM;
      if(document.activeElement!==$('pPageH')) $('pPageH').value=hMM;
      const preset=Object.entries(PAGE_PRESETS).find(([,[w,h]])=>w===wMM&&h===hMM);
      $('pPagePreset').value=preset?preset[0]:'custom';
      $('pDeletePage').disabled=S.pages.length<=1;
    }
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
  $('pTextCol').value=colour(rowV(sh,'Character','0','Color'),DEF.text).toLowerCase();
  const pt=num(sh,'LineWeight',0.01)*72, opts=[...$('pWeight').options].map(o=>+o.value);
  $('pWeight').value=String(opts.reduce((x,y)=>Math.abs(y-pt)<Math.abs(x-pt)?y:x));
  for(const w of ['textWrap','lineWrap','weightWrap','textColWrap']) $(w).hidden=table||key;
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
  $('lineWrap').hidden=$('weightWrap').hidden=$('textColWrap').hidden=!els.some(styleable);
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
  $('pTextCol').addEventListener('change',()=>{ const v=$('pTextCol').value; styleSelection(styleable,el=>setTextColour(el,v)); });
  $('pLine').addEventListener('change',()=>{ const v=$('pLine').value.toUpperCase();
    styleSelection(styleable,el=>{ setCell(el,'LineColor',v); if(num(shapeCtx(el,null),'LinePattern',1)===0) setCell(el,'LinePattern',1); }); });
  $('pWeight').addEventListener('change',()=>{ const v=+$('pWeight').value;
    styleSelection(styleable,el=>{ if(v===0) setCell(el,'LinePattern',0); else { setCell(el,'LinePattern',1); setCell(el,'LineWeight',v/72); } }); });
  $('pDelete').onclick=()=>deleteShapes(selIds());
  $('pAddRow').onclick=()=>{ if(S.sel) resizeTable(S.sel,true); };
  $('pDelRow').onclick=()=>{ if(S.sel) resizeTable(S.sel,false); };
  $('pText').addEventListener('change',()=>{ const el=selEl(); if(el) commit(()=>setText(el,$('pText').value)); });
  $('pW').addEventListener('change',sizeFromProps); $('pH').addEventListener('change',sizeFromProps);
  // Width and Height fire separately: the one not just edited must come from the page's own stored size, not from
  // what is on screen, which content may have already grown past that size (see pageSizeMM).
  $('pPageW').addEventListener('change',()=>{ const w=+$('pPageW').value||0; if(w>=50) setPageSize(S.pi,w,pageSizeMM(S.pi)[1]); });
  $('pPageH').addEventListener('change',()=>{ const h=+$('pPageH').value||0; if(h>=50) setPageSize(S.pi,pageSizeMM(S.pi)[0],h); });
  $('pPagePreset').addEventListener('change',()=>{
    const v=$('pPagePreset').value; if(v==='custom') return;
    const [w,h]=PAGE_PRESETS[v]; $('pPageW').value=w; $('pPageH').value=h; setPageSize(S.pi,w,h);
  });
  $('pFitPage').onclick=()=>{ if(!fitPageToContent()) toast('There is nothing on this page yet.'); };
  $('pPageName').addEventListener('change',()=>{ const v=$('pPageName').value.trim(); if(v) renamePage(S.pi,v); else $('pPageName').value=pageCtx().name; });
  $('pDeletePage').onclick=()=>{
    if(S.pages.length<=1){ toast('The last page cannot be deleted.'); return; }
    if(!confirm(`Delete "${pageCtx().name}"? Undo will bring it back.`)) return;
    deletePage(S.pi);
  };
  $('pFront').onclick=()=>{ const el=selEl(); if(el) moveStatement(el,true); };
  $('pBack').onclick=()=>{ const el=selEl(); if(el) moveStatement(el,false); };

  /* ---------- open / save: see the flow module ---------- */
  $('fileInput').addEventListener('change',async e=>{ const f=e.target.files[0]; e.target.value=''; if(f) await openAny(f,null); });
}
