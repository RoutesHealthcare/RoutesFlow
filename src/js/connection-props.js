/* ---------- connection settings in the properties panel ---------- */
import {$, S, kid, kids} from './core.js';
import {is1D, shapeCtx, shapeText} from './visio-package.js';
import {pageCtx, render} from './render.js';
import {connectsEl, refreshConnector} from './connectors.js';
import {selEl} from './properties.js';
import {CARDS, CONN, CONN_SETS, LINE_STYLES, MARKERS, cap, connMeans, edgeStyleOf, resolveType, setEdgeStyle, userV} from './flow/model.js';
import {keyStmt} from './flow/language.js';
import {modelPage} from './flow/sync.js';
import {commit, editDoc} from './document.js';

function fillConnSelect(sel){
  sel.replaceChildren();
  for(const set of CONN_SETS){ const og=document.createElement('optgroup'); og.label=set;
    for(const [k,c] of Object.entries(CONN)) if(c.set===set) og.appendChild(new Option(c.name,k)); sel.appendChild(og); }
}
export const typeStyle=t=>({style:CONN[t].style,start:CONN[t].start,end:CONN[t].end});
const labelOfFid=fid=>{ const top=kids(kid(pageCtx().doc.documentElement,'Shapes'),'Shape'), el=top.find(t=>userV(t,'FlowId')===fid); return el?shapeText(shapeCtx(el,null))||fid:fid; };
export function updateConnProps(el){
  const st=edgeStyleOf(el), t=resolveType(st), m=modelPage(S.pi).edges.find(e=>e.el===el);
  $('pConn').value=t;
  $('pConnMeans').textContent=connMeans(st,m&&m.from&&labelOfFid(m.from),m&&m.to&&labelOfFid(m.to));
  $('pErRow').hidden=t!=='er'; $('pCustom').hidden=t!=='custom';
  $('pCardStart').value=CARDS.includes(st.start)?st.start:'one'; $('pCardEnd').value=CARDS.includes(st.end)?st.end:'zeroMany';
  $('pStyle').value=st.style; $('pStart').value=st.start; $('pEnd').value=st.end; $('pRoute').value=st.route||'straight';
  if(document.activeElement!==$('pMeans')) $('pMeans').value=st.means; $('pMeans').placeholder=CONN[t].means;
}
const restyle=change=>{ const el=selEl(); if(!el||!is1D(shapeCtx(el,null))) return; const st={...edgeStyleOf(el),...change};
  S.newConn={style:st.style,start:st.start,end:st.end,route:st.route};   // new connections follow the last one changed $('pNewConn').value=resolveType(st)==='er'?'er':resolveType(st);
  commit(()=>setEdgeStyle(el,st)); };
export function moveStatement(el,front){
  const fid=userV(el,'FlowId'), ap=S.ast.pages[S.pi], d=fid&&(fid==='__key'?ap.key:ap.byId.get(fid));
  if(!d||d.implicit||d.line==null) return;
  const lines=[...ap.shapes.filter(s=>!s.implicit).map(s=>s.line),...(ap.key?[ap.key.line]:[])].sort((a,b)=>a-b);
  const target=front?lines[lines.length-1]:lines[0]; if(target===d.line) return;
  const L=S.text.split('\n'), text=L.splice(d.line,1)[0], t=target>d.line?target-1:target;   // removing the line shifts later lines up
  L.splice(front?t+1:t,0,text); editDoc(L.join('\n'),S.pi);
}

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  fillConnSelect($('pConn')); fillConnSelect($('pNewConn'));
  for(const [id,list] of [['pCardStart',CARDS],['pCardEnd',CARDS],['pStart',Object.keys(MARKERS)],['pEnd',Object.keys(MARKERS)],['pStyle',Object.keys(LINE_STYLES)]])
    for(const k of list) $(id).appendChild(new Option(id==='pStyle'?cap(k):MARKERS[k]||k,k));
  S.newConn=typeStyle('flow');
  $('pConn').addEventListener('change',()=>{ const t=$('pConn').value;
    restyle(t==='custom'?{}:t==='er'?{style:'solid',start:'one',end:'zeroMany'}:typeStyle(t)); });
  for(const id of ['pCardStart','pCardEnd']) $(id).addEventListener('change',()=>restyle({start:$('pCardStart').value,end:$('pCardEnd').value}));
  for(const id of ['pStyle','pStart','pEnd']) $(id).addEventListener('change',()=>restyle({style:$('pStyle').value,start:$('pStart').value,end:$('pEnd').value}));
  $('pMeans').addEventListener('change',()=>restyle({means:$('pMeans').value.trim()}));
  $('pRoute').addEventListener('change',()=>restyle({route:$('pRoute').value==='elbow'?'elbow':null,via:null}));
  $('pReverse').onclick=()=>{ const el=selEl(); if(!el) return; const id=el.getAttribute('ID');
    commit(()=>{ const cons=kids(connectsEl(pageCtx().doc,false),'Connect').filter(c=>c.getAttribute('FromSheet')===id);
      const b=cons.find(c=>c.getAttribute('FromCell')==='BeginX'), e=cons.find(c=>c.getAttribute('FromCell')==='EndX');
      if(b&&e){ const t=b.getAttribute('ToSheet'); b.setAttribute('ToSheet',e.getAttribute('ToSheet')); e.setAttribute('ToSheet',t); render(); refreshConnector(id); } }); };
  $('pNewConn').addEventListener('change',()=>{ const t=$('pNewConn').value; S.newConn=t==='er'?{style:'solid',start:'one',end:'zeroMany'}:typeStyle(t==='custom'?'flow':t); });
  $('pAddKey').onclick=()=>{
    const ap=S.ast.pages[S.pi], L=S.text.split('\n');
    if(ap.key){ L.splice(ap.key.line,1); editDoc(L.join('\n'),S.pi); return; }
    const at=ap.lastShapeLine??ap.headerLine??ap.endLine; L.splice(at+1,0,keyStmt({title:'Key'})); editDoc(L.join('\n'),S.pi);
  };
}
