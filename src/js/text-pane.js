/* ---------- the text pane: a tab that can be hidden, opened over the canvas, or pinned beside it ---------- */
import {$, S, kid, kids, svg, toast} from './core.js';
import {is1D, shapeCtx} from './visio-package.js';
import {applyView, pageCtx, render, renderTabs} from './render.js';
import {select} from './selection.js';
import {updateProps} from './properties.js';
import {EXPORTERS, FMT, exportIds, pageGraph, plural} from './formats/export.js';
import {IMPORTERS} from './formats/import.js';
import {applyTags, resolveType, userV} from './flow/model.js';
import {FLOW_KINDS, KIND_ALIASES, parseFlow, splitComment} from './flow/language.js';
import {editDoc, rebuild, selMemo, setDirty} from './document.js';
import {graphStatements, replacePageBody} from './visio-io.js';

export const TP={open:false,pinned:false,mode:'flow',dirty:false,errors:[],timer:0,lastTyped:0,cur:-1};
let codeText, codeHl, codeGutter;
function storePane(){ try{ localStorage.setItem('flowEditor.pane',JSON.stringify({open:TP.open,pinned:TP.pinned,w:getComputedStyle(document.body).getPropertyValue('--tpw').trim()})); }catch(_){ /* storage can be unavailable; the pane still works */ } }
export function setPane(open,pinned){
  TP.open=open; TP.pinned=pinned;
  $('textPane').hidden=!open; $('textTab').hidden=open;
  document.body.classList.toggle('tp-pinned',open&&pinned); $('textPane').classList.toggle('floating',open&&!pinned);
  $('tpPin').setAttribute('aria-pressed',String(pinned)); $('tpPin').textContent=pinned?'Unpin':'Pin';
  storePane(); if(open) refreshEditor(true); applyView();
}
let FLOW_KW, KIND_RE;
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function hlFlowLine(line){
  const {code,comment}=splitComment(line); let out='', p=0;
  const re=/("(?:[^"\\]|\\.)*"?)|(@\s*-?[\d.]+\s*,\s*-?[\d.]+(?:\s+[\d.]+\s*x\s*[\d.]+)?)|(\[[^\]]*\]?)|(\{[^}]*\}?)|((?<=\s)(?:o--|\*--|[|}][|o](?:--|\.\.)[|o][|{])(?=\s))|([A-Za-z_][\w-]*)(\s*:)?|(\S+)/g; let m, first=true;
  while((m=re.exec(code))){
    out+=esc(code.slice(p,m.index)); p=re.lastIndex;
    if(m[1]) out+=`<span class="s">${esc(m[1])}</span>`;
    else if(m[2]) out+=`<span class="n">${esc(m[2])}</span>`;
    else if(m[3]||m[4]) out+=`<span class="a">${esc(m[3]||m[4])}</span>`;
    else if(m[5]) out+=`<span class="o">${esc(m[5])}</span>`;
    else if(m[6]){ const w=m[6];
      if(first&&FLOW_KW.test(w)&&!m[7]) out+=`<span class="k">${esc(w)}</span>`;
      else if(m[7]) out+=`<span class="i">${esc(w)}</span>${esc(m[7])}`;
      else if(KIND_RE.test(w)&&/:\s*\S*$/.test(code.slice(0,m.index))) out+=`<span class="t">${esc(w)}</span>`;
      else if(/^(size|direction)$/.test(w)) out+=`<span class="k">${esc(w)}</span>`;
      else out+=`<span class="i">${esc(w)}</span>`; }
    else out+=`<span class="o">${esc(m[8])}</span>`;
    first=false;
  }
  out+=esc(code.slice(p));
  return out+(comment?`<span class="c">${esc(comment)}</span>`:'');
}
function hlOtherLine(line){
  const c=line.match(/^(\s*)(%%|'|\/\/|#)(.*)$/); if(c) return esc(c[1])+`<span class="c">${esc(c[2]+c[3])}</span>`;
  return esc(line).replace(/(&quot;|")((?:[^"\\]|\\.)*)(")/g,'<span class="s">"$2"</span>').replace(/(--+>|-\.->|==>|-->|\.\.>|->|--|\.\.|&lt;--&gt;)/g,'<span class="o">$1</span>');
}
export function paintCode(){
  const lines=codeText.value.split('\n'), errs=new Map((TP.mode==='flow'?TP.errors:[]).map(e=>[e.line,e.msg]));
  const hl=TP.mode==='flow'?hlFlowLine:hlOtherLine;
  codeHl.innerHTML=lines.map((l,i)=>`<div class="l${errs.has(i)?' err':''}${i===TP.cur?' cur':''}">${hl(l)||'&#8203;'}</div>`).join('');
  codeGutter.innerHTML=lines.map((_,i)=>`<div class="${errs.has(i)?'err':''}">${i+1}</div>`).join('');
  syncScroll();
  if(TP.mode==='flow'){
    $('tpStatus').classList.toggle('error',!!TP.errors.length);
    $('tpStatus').textContent=TP.errors.length?`Line ${TP.errors[0].line+1}: ${TP.errors[0].msg}`+(TP.errors.length>1?` (and ${plural(TP.errors.length-1,'more problem')})`:''):'Changes apply as you type. Placements are in millimetres from the top left of the page.';
  }
}
function syncScroll(){ const x=codeText.scrollLeft, y=codeText.scrollTop; codeHl.style.transform=`translate(${-x}px,${-y}px)`; codeGutter.style.transform=`translateY(${-y}px)`; }
function setCode(t){ if(codeText.value===t){ paintCode(); return; } const y=codeText.scrollTop, x=codeText.scrollLeft; codeText.value=t; codeText.scrollTop=y; codeText.scrollLeft=x; paintCode(); }
export function curLineFor(){   // the text line of the selected shape or connection
  const el=S.sel&&S.elById[S.sel], ap=S.ast&&S.ast.pages[S.pi]; if(!el||!ap) return -1;
  if(is1D(shapeCtx(el,null))){ const k=userV(el,'FlowEdge'); return k!=null?+k:-1; }
  const fid=userV(el,'FlowId'); if(fid==='__key') return ap.key?ap.key.line:-1;
  const d=fid&&ap.byId.get(fid); return d&&d.line!=null?d.line:-1;
}
export function refreshEditor(force){
  if(!TP.open) return;
  TP.cur=TP.mode==='flow'?curLineFor():-1;
  const typing=document.activeElement===codeText;
  if(TP.mode==='flow'){
    if(!typing||force) setCode(S.text); else paintCode();
    if(!typing&&TP.cur>=0){ const top=TP.cur*18, v=codeText.scrollTop, hgt=codeText.clientHeight; if(top<v||top>v+hgt-36) codeText.scrollTop=Math.max(0,top-hgt/3); syncScroll(); }
  } else if(!TP.dirty||force){
    try{ const g=pageGraph(); setCode(EXPORTERS[TP.mode](g)); TP.dirty=false; setStatus(g.warnings.join(' ')||'Edit and press Apply. Shapes keep their positions when their names match.'); }
    catch(e){ console.error('Could not show the page as',TP.mode,e); setStatus('Could not show this page: '+e.message,true); }
  }
  $('tpApply').hidden=$('tpRevert').hidden=TP.mode==='flow';
  $('tpApply').disabled=$('tpRevert').disabled=!TP.dirty;
}
function setStatus(msg,isErr){ $('tpStatus').textContent=msg; $('tpStatus').classList.toggle('error',!!isErr); }
export function applyFromEditor(now){
  clearTimeout(TP.timer);
  const run=()=>{
    const t=codeText.value.replace(/\r\n?/g,'\n'); if(t===S.text) return;
    const ast=parseFlow(t);
    if(ast.errors.length){ TP.errors=ast.errors; paintCode(); return; }
    const t0=Date.now(); if(!TP.lastTyped||t0-TP.lastTyped>1500){ S.undo.push({text:S.text,pi:S.pi}); S.redo=[]; }
    TP.lastTyped=t0; S.text=t; setDirty(true); rebuild(selMemo()); updateProps();
  };
  if(now) run(); else TP.timer=setTimeout(run,350);
}
async function applyForeign(){
  const fmt=TP.mode, text=codeText.value;
  try{
    const g=applyTags(await IMPORTERS[fmt](text));
    const cur=pageGraph(), rev={}, byLabel={}; for(const [fid,eid] of Object.entries(exportIds(cur))) rev[eid]=fid;
    for(const n of cur.nodes) if(!byLabel[n.label]) byLabel[n.label]=n.id;
    const ap=S.ast.pages[S.pi];
    for(const n of g.nodes){
      const fid=rev[n.id]||(fmt==='activity'?byLabel[n.label]:null); if(!fid) continue;
      const d=ap.byId.get(fid); n.id=fid;
      if(d&&!d.implicit){ n.keepPlace=d.place||null; n.keepAttrs=d.attrs; if(n.kind==='process'&&d.kind!=='process'&&fmt==='activity') n.kind=d.kind; if(d.kind==='table'&&!n.columns) n.columns=d.columns; }
    }
    for(const e of g.edges){ const old=ap.edges.find(o=>o.from===e.from&&o.to===e.to);
      if(old&&resolveType({style:e.style||'solid',start:e.start||'none',end:e.end||'arrow'})==='flow') Object.assign(e,{style:old.style,start:old.start,end:old.end,means:old.means,stroke:old.stroke,weight:old.weight}); }
    const {lines}=graphStatements(g,{placed:false,used:new Set()});
    TP.dirty=false; editDoc(replacePageBody(S.text,ap,lines),S.pi); refreshEditor(true);
    toast(`Applied ${FMT[fmt].name} to ${ap.name}.`+(g.warnings.length?' '+g.warnings.join(' '):''),g.warnings.length?9000:4500);
  }catch(e){ console.error('Apply failed',e); setStatus('Could not apply: '+e.message,true); }
}
const caretLine=()=>codeText.value.slice(0,codeText.selectionStart).split('\n').length-1;
function selectFromCaret(){
  if(TP.mode!=='flow'||!S.ast) return;
  const line=caretLine(); if(line===TP.cur) return;
  S.ast.pages.forEach((ap,pi)=>{
    const d=ap.shapes.find(s=>s.line===line), e=ap.edgeByLine.get(line), k=ap.key&&ap.key.line===line?ap.key:null; if(!d&&!e&&!k) return;
    if(pi!==S.pi){ S.pi=pi; renderTabs(); render(); }
    const top=kids(kid(pageCtx().doc.documentElement,'Shapes'),'Shape');
    const el=top.find(t=>d?userV(t,'FlowId')===d.id:k?userV(t,'FlowId')==='__key':userV(t,'FlowEdge')===String(line));
    if(el){ select(el.getAttribute('ID')); TP.cur=line; paintCode(); }
  });
}

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  codeText=$('codeText'); codeHl=$('codeHl'); codeGutter=$('codeGutter');
  try{ const p=JSON.parse(localStorage.getItem('flowEditor.pane')||'null'); if(p){ if(p.w) document.body.style.setProperty('--tpw',p.w); TP.open=!!p.open; TP.pinned=!!p.pinned; } }catch(_){ /* first run or storage blocked */ }FLOW_KW=/\b(flow|page|size|direction|key|icon)\b/; KIND_RE=new RegExp('^(?:'+[...FLOW_KINDS,...Object.keys(KIND_ALIASES)].join('|')+')$','i');
  codeText.addEventListener('input',()=>{ if(TP.mode==='flow'){ paintCode(); applyFromEditor(); } else { TP.dirty=true; paintCode(); refreshEditor(); setStatus('Not applied yet.'); } });
  codeText.addEventListener('scroll',syncScroll);
  codeText.addEventListener('keydown',e=>{
    if(e.key==='Tab'&&!e.shiftKey){ e.preventDefault(); document.execCommand('insertText',false,'  '); }
    else if(e.key==='Escape'){ codeText.blur(); }
  });
  codeText.addEventListener('click',selectFromCaret); codeText.addEventListener('keyup',e=>{ if(e.key.startsWith('Arrow')||e.key==='Home'||e.key==='End'||e.key.startsWith('Page')) selectFromCaret(); });
  codeText.addEventListener('blur',()=>{ if(TP.mode==='flow') applyFromEditor(true); });
  $('tpLang').addEventListener('change',()=>{
    if(TP.dirty&&!confirm('Your unapplied edits will be lost. Continue?')){ $('tpLang').value=TP.mode; return; }
    if(TP.mode==='flow') applyFromEditor(true);
    TP.mode=$('tpLang').value; TP.dirty=false; refreshEditor(true);
  });
  $('tpApply').onclick=applyForeign;
  $('tpRevert').onclick=()=>{ TP.dirty=false; refreshEditor(true); };
  $('tpPin').onclick=()=>setPane(true,!TP.pinned);
  $('tpClose').onclick=()=>setPane(false,TP.pinned);
  $('textTab').onclick=()=>setPane(true,TP.pinned);
  svg.addEventListener('pointerdown',()=>{ if(TP.open&&!TP.pinned) setPane(false,false); },true);
  (()=>{ let start=null;   // drag the pane's left edge to resize it
    $('tpResize').addEventListener('pointerdown',e=>{ start={x:e.clientX,w:$('textPane').getBoundingClientRect().width}; $('tpResize').setPointerCapture(e.pointerId); e.preventDefault(); });
    $('tpResize').addEventListener('pointermove',e=>{ if(!start) return; const w=Math.max(280,Math.min(window.innerWidth*0.7,start.w+(start.x-e.clientX))); document.body.style.setProperty('--tpw',w+'px'); applyView(); });
    $('tpResize').addEventListener('pointerup',()=>{ start=null; storePane(); });
  })();
}
