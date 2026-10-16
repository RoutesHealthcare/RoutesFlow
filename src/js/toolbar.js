/* ---------- toolbar and keys ---------- */
import {$, MM, S, svg} from './core.js';
import {applyView, fit, zoomAt} from './render.js';
import {copySelection, deleteShapes, duplicate, moveMany, pasteClipboard, selIds, select, selectAll} from './selection.js';
import {editText} from './text-editor.js';
import {setSpaceHeld} from './pointer.js';
import {setTool} from './palette.js';
import {commit, newDoc, redo, undo} from './document.js';
import {openFile, save} from './visio-io.js';
import {TP, setPane} from './text-pane.js';

const zc=f=>{ const r=svg.getBoundingClientRect(); zoomAt(f,r.width/2,r.height/2); };

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  $('btnNew').onclick=async()=>{ if(S.dirty&&!confirm('Discard unsaved changes and start a new drawing?')) return; await newDoc(); };
  $('btnOpen').onclick=openFile;
  $('btnSave').onclick=()=>save(false);
  $('btnSaveAs').onclick=()=>save(true);
  $('btnUndo').onclick=undo; $('btnRedo').onclick=redo;
  $('btnZoomIn').onclick=()=>zc(1.25); $('btnZoomOut').onclick=()=>zc(0.8); $('btnFit').onclick=fit;
  document.addEventListener('keydown',e=>{
    if(document.querySelector('dialog[open]')) return;   // keys belong to the open dialog
    const typing=['INPUT','TEXTAREA','SELECT'].includes((document.activeElement||{}).tagName);
    const mod=e.ctrlKey||e.metaKey, k=e.key.toLowerCase(), one=S.selection.size===1;
    if(mod&&k==='s'){ e.preventDefault(); save(e.shiftKey); return; }
    if(mod&&k==='o'){ e.preventDefault(); openFile(); return; }
    if(mod&&k==='e'){ e.preventDefault(); setPane(!TP.open,TP.pinned); return; }
    if(typing) return;
    if(e.key===' '&&!mod&&(document.activeElement||{}).tagName!=='BUTTON'){ e.preventDefault(); if(!e.repeat) setSpaceHeld(true); return; }
    if(mod&&k==='z'){ e.preventDefault(); e.shiftKey?redo():undo(); return; }
    if(mod&&k==='y'){ e.preventDefault(); redo(); return; }
    if(mod&&k==='a'){ e.preventDefault(); selectAll(); return; }
    if(mod&&k==='d'){ e.preventDefault(); duplicate(); return; }
    if(mod&&k==='c'){ e.preventDefault(); copySelection(); return; }
    if(mod&&k==='v'){ e.preventDefault(); pasteClipboard(); return; }
    if((e.key==='Delete'||e.key==='Backspace')&&S.selection.size){ e.preventDefault(); deleteShapes(selIds()); return; }
    if(e.key==='Escape'){ setTool('select'); select(null); return; }
    if(e.key.startsWith('Arrow')&&S.selection.size){
      e.preventDefault(); const st=(e.shiftKey?10:1)*MM, ids=selIds();
      const d={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,st],ArrowDown:[0,-st]}[e.key];
      commit(()=>moveMany(ids,d[0],d[1])); return;
    }
    if((e.key==='F2'||e.key==='Enter')&&one){ e.preventDefault(); editText(S.sel); return; }
    if(!mod&&!e.altKey&&e.key.length===1&&one){ e.preventDefault(); editText(S.sel,e.key); }
  });
  document.addEventListener('keyup',e=>{ if(e.key===' ') setSpaceHeld(false); });
  window.addEventListener('blur',()=>setSpaceHeld(false));
  window.addEventListener('beforeunload',e=>{ if(S.dirty){ e.preventDefault(); e.returnValue=''; } });
  window.addEventListener('resize',()=>applyView());
}
