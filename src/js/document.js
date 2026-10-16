/* ---------- document state, undo and rebuild ---------- */
import {S, kid, kids, toast} from './core.js';
import {is1D, shapeCtx} from './visio-package.js';
import {fit, pageCtx, render, renderTabs, updateTitle} from './render.js';
import {selIds} from './selection.js';
import {commitText} from './text-editor.js';
import {updateProps} from './properties.js';
import {plural} from './formats/export.js';
import {userV} from './flow/model.js';
import {parseFlow} from './flow/language.js';
import {buildModel, syncFromModel} from './flow/sync.js';
import {TP, refreshEditor, setPane} from './text-pane.js';

const BLANK_FLOW='flow 1\n\npage "Page-1" size 297x210\n';
/* a new shape has no FlowId until syncFromModel names it, so keep the element and read its name back at reselect time */
const memoFor=el=>is1D(shapeCtx(el,null))?{edgeEl:el,key:userV(el,'FlowEdge')}:{el,fid:userV(el,'FlowId')};
/* the primary selection comes first so it stays primary after a rebuild */
export function selMemo(){
  const ids=[S.sel,...selIds().filter(id=>id!==S.sel)].filter(id=>id&&S.elById[id]);
  return ids.length?ids.map(id=>memoFor(S.elById[id])):null;
}
function findByMemo(memo,sync,top){
  const fid=memo.fid||(memo.el&&userV(memo.el,'FlowId'));
  if(fid) return top.find(t=>userV(t,'FlowId')===fid)||null;
  if(memo.el) return null;
  let line=sync&&sync.placedTags&&sync.placedTags.get(memo.edgeEl);
  if(line==null&&memo.key!=null) line=sync&&sync.lineMap?sync.lineMap.get(+memo.key):+memo.key;
  return line!=null?top.find(t=>userV(t,'FlowEdge')===String(line))||null:null;
}
function reselect(memos,sync){
  if(!memos){ S.sel=null; S.selection=new Set(); return; }
  const pg=pageCtx(); if(!pg) return;
  const top=kids(kid(pg.doc.documentElement,'Shapes'),'Shape');
  const ids=[].concat(memos).map(m=>findByMemo(m,sync,top)).filter(Boolean).map(el=>el.getAttribute('ID'));
  S.sel=ids[0]??null; S.selection=new Set(ids);
}
export function rebuild(memo,sync){
  const ast=parseFlow(S.text);
  S.ast=ast; TP.errors=ast.errors;
  buildModel(ast); reselect(memo,sync);
  renderTabs(); render(); refreshEditor();
  if(ast.errors.length) console.error('Flow text has errors',ast.errors);
  return !ast.errors.length;
}
export function snapshot(){ return S.text; }
export function setDirty(v){ S.dirty=v; updateTitle(); }
export function pushUndo(snap){
  const memo=selMemo(), sync=syncFromModel();
  if(S.text!==snap){ S.undo.push({text:snap,pi:S.pi}); if(S.undo.length>200) S.undo.shift(); S.redo=[]; setDirty(true); TP.lastTyped=0; }
  rebuild(memo,sync);
}
export function commit(fn){ const snap=snapshot(); fn(); pushUndo(snap); }
export function editDoc(text,pi){   // a change made directly to the text, such as an import or a page added
  if(text===S.text) return; S.undo.push({text:S.text,pi:S.pi}); S.redo=[]; S.text=text; if(pi!=null) S.pi=pi; setDirty(true); rebuild(selMemo()); fit();
}
function restore(from,to){
  const u=from.pop(); if(!u) return;
  to.push({text:S.text,pi:S.pi}); S.text=u.text; S.pi=u.pi; setDirty(true); rebuild(selMemo()); updateProps();
}
export const undo=()=>{ if(S.editing) commitText(); restore(S.undo,S.redo); };
export const redo=()=>{ if(S.editing) commitText(); restore(S.redo,S.undo); };
export function loadText(text,name,handle){
  S.text=text.replace(/\r\n?/g,'\n'); S.name=name; S.handle=handle||null; S.undo=[]; S.redo=[]; S.sel=null; S.pi=0; S.dirty=false;
  rebuild(null); updateTitle(); fit(); updateProps();
  if(TP.errors.length){ setPane(true,TP.pinned); toast(`${plural(TP.errors.length,'line')} in this file could not be read. They are marked in the text.`,8000); }
}
export function newDoc(){ loadText(BLANK_FLOW,'Untitled.flow',null); }
