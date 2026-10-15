/* ---------- text to canvas ---------- */
import {DEF, NS, RNS, S, cellEl, colour, kid, kids, mk, parseXml, setCell} from '../core.js';
import {cellV, is1D, numEl, rowCellEl, rowV, setText, shapeCtx, shapeText} from '../visio-package.js';
import {render} from '../render.js';
import {centreOf, connectsEl, refreshConnector, setConnector, setGlue} from '../connectors.js';
import {SHAPES, buildConnector, buildShape, buildTable, ensureShapes, pxToIn, roleOf, setRole, tableParts} from '../shapes.js';
import {layoutGraph} from '../layout.js';
import {CONN, connName, edgeStyleOf, resolveType, setEdgeStyle, setTextPt, setUser, SHAPE_TEXT_PT, textPt, userV, weightOf} from './model.js';
import {autoSizeMM, declObj, edgeStmt, keyStmt, shapeStmt, splitComment, tableH, uniqueFid} from './language.js';

export const PAGE_MARGIN=15, LOOSE_GAP=10;   // mm
function emptyPageDoc(){ return parseXml(`<PageContents xmlns="${NS}" xmlns:r="${RNS}" xml:space="preserve"/>`); }
function layoutPage(ap,sizes){
  const pos=new Map(), placed=ap.shapes.filter(d=>d.place), loose=ap.shapes.filter(d=>!d.place);
  for(const d of placed) pos.set(d.id,{x:d.place.x,y:d.place.y});
  if(!loose.length) return pos;
  if(!placed.length){   // nothing placed yet: lay the whole page out in layers
    const g={nodes:ap.shapes.map(d=>({id:d.id,kind:d.kind,label:d.label,columns:d.columns,w:sizes.get(d.id).w/25.4,h:sizes.get(d.id).h/25.4})),
      edges:ap.edges.map(e=>({from:e.from,to:e.to})),direction:ap.direction,positioned:false,warnings:[]};
    layoutGraph(g); for(const n of g.nodes) pos.set(n.id,{x:PAGE_MARGIN+n.x*25.4,y:PAGE_MARGIN+n.y*25.4});
    return pos;
  }
  /* some shapes are placed: put each unplaced shape next to a shape it connects to, in the first free spot */
  const boxes=placed.map(d=>({...pos.get(d.id),...sizes.get(d.id)}));
  const free=(x,y,w,h)=>boxes.every(b=>x+w+LOOSE_GAP<=b.x||b.x+b.w+LOOSE_GAP<=x||y+h+LOOSE_GAP<=b.y||b.y+b.h+LOOSE_GAP<=y);
  const nb=id=>ap.edges.filter(e=>e.from===id||e.to===id).map(e=>({other:e.from===id?e.to:e.from,below:e.to===id}));
  const queue=[...loose].sort((a,b)=>nb(b.id).filter(n=>pos.has(n.other)).length-nb(a.id).filter(n=>pos.has(n.other)).length);
  const right=()=>Math.max(...boxes.map(b=>b.x+b.w)), top=()=>Math.min(...boxes.map(b=>b.y));
  const pending=[...queue];
  for(let guard=0;pending.length&&guard<pending.length*pending.length+5;guard++){
    let k=pending.findIndex(d=>nb(d.id).some(n=>pos.has(n.other))); const lone=k<0; if(lone) k=0;
    const d=pending.splice(k,1)[0], {w,h}=sizes.get(d.id); let x, y;
    if(!lone){ const n=nb(d.id).find(n=>pos.has(n.other)), o=pos.get(n.other), os=sizes.get(n.other);
      x=o.x+os.w/2-w/2; y=n.below?o.y+os.h+LOOSE_GAP*1.5:o.y-h-LOOSE_GAP*1.5; if(y<PAGE_MARGIN) y=o.y+os.h+LOOSE_GAP*1.5; }
    else { x=right()+LOOSE_GAP*2; y=top(); }
    for(let t=0;t<60&&!free(x,y,w,h);t++){ if(t%2===0) x+=w/2+LOOSE_GAP; else y+=h/2+LOOSE_GAP/2; }
    pos.set(d.id,{x,y}); boxes.push({x,y,w,h});
  }
  return pos;
}
function applyShapeAttrs(el,a){
  if(a.fill){ setCell(el,'FillForegnd',a.fill); setCell(el,'FillPattern',1); }
  if(a.stroke){ setCell(el,'LineColor',a.stroke); if(numEl(el,'LinePattern',1)===0) setCell(el,'LinePattern',1); }
  if(a.weight) setCell(el,'LineWeight',a.weight/72);
  if(a.icon) setUser(el,'FlowIcon',a.icon);
  if(a.size) setTextPt(el,a.size);
  const tc=rowCellEl(el,'Character','0','Color'); if(a.text&&tc) tc.setAttribute('V',a.text);
}
function keyRows(ap){
  const rows=new Map(), order=Object.keys(CONN);
  for(const e of ap.edges){ const t=resolveType(e), k=t==='er'?`er|${e.style}|${e.start}|${e.end}`:t==='custom'?`custom|${e.style}|${e.start}|${e.end}|${e.means}`:`${t}|${e.means}`;
    if(!rows.has(k)) rows.set(k,{e,t,name:connName(e),means:e.means||CONN[t].means}); }
  return [...rows.values()].sort((a,b)=>order.indexOf(a.t)-order.indexOf(b.t));
}
/* the key is a group: a frame, a title and one sample line plus explanation per connection type used on the page */
function buildKey(doc,first,L,Ttop,pg,title,rows){
  const P=0.12, TH=0.36, LINE=0.7, CH=0.068;
  const texts=rows.length?rows.map(r=>`${r.name}: ${r.means}`):['No connections on this page yet.'];
  const TW=Math.min(4.6,Math.max(1.8,...texts.map(t=>t.length*CH)));
  const hs=texts.map(t=>Math.max(0.3,Math.ceil(t.length*CH/TW)*0.2+0.1)), H=TH+hs.reduce((a,b)=>a+b,0)+P, W=P+LINE+P+TW+P;
  let next=first; const B=pg.h-(Ttop+H);
  const g=mk(doc,'Shape',{ID:String(next++),Type:'Group',LineStyle:'0',FillStyle:'0',TextStyle:'0'}), C=(n,v,f,u)=>g.appendChild(cellEl(doc,n,v,f,u));
  C('PinX',L+W/2,null,'MM'); C('PinY',B+H/2,null,'MM'); C('Width',W,null,'MM'); C('Height',H,null,'MM');
  C('LocPinX',W/2,'Width*0.5','MM'); C('LocPinY',H/2,'Height*0.5','MM'); C('Angle',0,null,'DEG'); C('FlipX',0); C('FlipY',0);
  setRole(g,'key'); setUser(g,'FlowId','__key'); setUser(g,'FlowKeyTitle',title);
  const inner=doc.createElementNS(NS,'Shapes'); g.appendChild(inner);
  const part=el=>{ setRole(el,'keyPart'); inner.appendChild(el); return el; };
  const left=el=>{ const c=rowCellEl(el,'Paragraph','0','HorzAlign'); if(c) c.setAttribute('V','0'); return el; };
  part(buildShape(doc,'process',String(next++),0,0,W,H,''));
  const head=left(part(buildShape(doc,'text',String(next++),P,H-TH,W-2*P,TH,title)));
  const chr=kids(head,'Section').find(sec=>sec.getAttribute('N')==='Character'), row=chr&&kid(chr,'Row'); if(row) row.appendChild(cellEl(doc,'Style',1));
  let y=H-TH;
  texts.forEach((t,i)=>{ y-=hs[i];
    if(rows[i]){ const mid=y+hs[i]-0.15, ln=buildConnector(doc,String(next++),[P,mid],[P+LINE,mid]); setEdgeStyle(ln,rows[i].e); setCell(ln,'LineColor',DEF.line); setConnector(ln,[P,mid],[P+LINE,mid],null,null); part(ln); }
    left(part(buildShape(doc,'text',String(next++),P+LINE+P,y,TW,hs[i],t))); });
  return {el:g,w:W*25.4,h:H*25.4,next};
}
export function buildModel(ast){
  const keepPi=S.pi; S.pages=[]; S.built=[]; S.masters={}; S.styles={};
  ast.pages.forEach((ap,pi)=>{
    const sizes=new Map();
    for(const d of ap.shapes){ const auto=autoSizeMM(d), p=d.place; sizes.set(d.id,{w:p&&p.w!=null?p.w:auto.w,h:d.kind==='table'?auto.h:p&&p.h!=null?p.h:auto.h}); }
    const pos=layoutPage(ap,sizes), ext={x:0,y:0};
    for(const d of ap.shapes){ const p=pos.get(d.id), s=sizes.get(d.id); ext.x=Math.max(ext.x,p.x+s.w); ext.y=Math.max(ext.y,p.y+s.h); }
    const rows=ap.key?keyRows(ap):null;
    const keyAt=ap.key?(ap.key.place||{x:ext.x+LOOSE_GAP*2,y:PAGE_MARGIN}):null;
    if(keyAt){ ext.x=Math.max(ext.x,keyAt.x+130); ext.y=Math.max(ext.y,keyAt.y+20+rows.length*12); }
    const pw=Math.max(ap.size?ap.size[0]:297,ext.x+PAGE_MARGIN), ph=Math.max(ap.size?ap.size[1]:210,ext.y+PAGE_MARGIN);
    const pg={name:ap.name,w:pw/25.4,h:ph/25.4,doc:emptyPageDoc(),bg:false};
    S.pages.push(pg); S.pi=pi;
    const doc=pg.doc, shapes=ensureShapes(doc), built=new Map(), elOf=new Map(); let next=1;
    for(const d of ap.shapes){
      const {w,h}=sizes.get(d.id), {x,y}=pos.get(d.id), L=x/25.4, B=pg.h-(y+h)/25.4; let el;
      if(d.kind==='table'){ el=buildTable(doc,next,L,B,w/25.4,d.label||'table',d.columns); next+=2+d.columns.length; }
      else { el=buildShape(doc,d.kind,String(next++),L,B,w/25.4,h/25.4,d.label||''); applyShapeAttrs(el,d.attrs||{}); }
      setUser(el,'FlowId',d.id); shapes.appendChild(el); elOf.set(d.id,el.getAttribute('ID')); built.set(d.id,{x,y,w,h});
    }
    if(ap.key){ const k=buildKey(doc,next,keyAt.x/25.4,keyAt.y/25.4,pg,ap.key.title,rows); next=k.next; shapes.appendChild(k.el); built.set('__key',{x:keyAt.x,y:keyAt.y,w:k.w,h:k.h}); }
    render();
    const conns=[];
    for(const e of ap.edges){
      const a=elOf.get(e.from), b=elOf.get(e.to); if(!a||!b) continue;
      const id=String(next++), el=buildConnector(doc,id,pxToIn(centreOf(a),pg),pxToIn(centreOf(b),pg));
      shapes.appendChild(el); setEdgeStyle(el,e); if(e.label) setText(el,e.label); setUser(el,'FlowEdge',String(e.line));
      setGlue(id,'Begin',a); setGlue(id,'End',b); conns.push(id);
    }
    render(); for(const id of conns) refreshConnector(id);
    S.built.push(built);
  });
  S.pi=Math.max(0,Math.min(keepPi,S.pages.length-1));
}

/* ---------- canvas to text ---------- */
export function geoMM(el,pg){ const W=numEl(el,'Width',0), H=numEl(el,'Height',0), L=numEl(el,'PinX',0)-numEl(el,'LocPinX',W/2), B=numEl(el,'PinY',0)-numEl(el,'LocPinY',H/2);
  return {x:L*25.4,y:(pg.h-(B+H))*25.4,w:W*25.4,h:H*25.4}; }
export function modelPage(pi){
  const pg=S.pages[pi], doc=pg.doc, top=kids(kid(doc.documentElement,'Shapes'),'Shape'), topOf={}, fidOf={}, shapes=[], edges=[];
  const used=new Set(top.map(el=>userV(el,'FlowId')).filter(Boolean)); let key=null;
  for(const el of top){ topOf[el.getAttribute('ID')]=el; for(const c of el.getElementsByTagNameNS(NS,'Shape')) topOf[c.getAttribute('ID')]=el; }
  for(const el of top){
    const sh=shapeCtx(el,null); if(is1D(sh)) continue;
    const role=roleOf(el), geo=geoMM(el,pg);
    if(role==='key'){ key={title:userV(el,'FlowKeyTitle')||'Key',geo}; continue; }
    const kind=role&&SHAPES[role]&&!/^table(Header|Row)$/.test(role)?role:'process', s={el,kind,geo,attrs:{}};
    if(kind==='table'){ const p=tableParts(el); s.label=p.header?shapeText(shapeCtx(p.header,null)):''; s.columns=p.rows.map(r=>shapeText(shapeCtx(r,null))); }
    else {
      s.label=shapeText(sh); const T=SHAPES[kind], diff=(v,d)=>v&&v.toUpperCase()!==String(d).toUpperCase()?v.toUpperCase():null;
      s.attrs={fill:T.bare?null:diff(colour(cellV(sh,'FillForegnd',null),null),T.fill||DEF.fill),stroke:T.bare?null:diff(colour(cellV(sh,'LineColor',null),null),DEF.line),
        text:diff(colour(rowV(sh,'Character','0','Color'),null),T.textColour||DEF.text),weight:T.bare?null:weightOf(sh),icon:userV(el,'FlowIcon')||null,
        size:(pt=>pt&&Math.abs(pt-SHAPE_TEXT_PT)>0.01?pt:null)(textPt(sh))};
    }
    let fid=userV(el,'FlowId'); if(!fid){ fid=uniqueFid(s.label||kind,used); used.add(fid); setUser(el,'FlowId',fid); }
    s.id=fid; fidOf[el.getAttribute('ID')]=fid; shapes.push(s);
  }
  const cons=kids(connectsEl(doc,false),'Connect');
  for(const el of top){
    const sh=shapeCtx(el,null); if(!is1D(sh)) continue; const id=el.getAttribute('ID');
    const end=e=>{ const c=cons.find(c=>c.getAttribute('FromSheet')===id&&c.getAttribute('FromCell')===e+'X'), t=c&&topOf[c.getAttribute('ToSheet')]; return t?fidOf[t.getAttribute('ID')]||null:null; };
    edges.push({el,key:userV(el,'FlowEdge'),from:end('Begin'),to:end('End'),label:shapeText(sh).trim(),...edgeStyleOf(el)});
  }
  return {shapes,edges,key};
}
function modelShapeObj(s,d,built){
  const b=built.get(s.id), g=s.geo, near=(a,c)=>Math.abs(a-c)<=0.06;
  const moved=!b||!near(b.x,g.x)||!near(b.y,g.y), resized=!b||!near(b.w,g.w)||(s.kind!=='table'&&!near(b.h,g.h));
  const auto=autoSizeMM(s), had=d&&!d.implicit&&d.place&&d.place.w!=null;
  const sized=had||(resized&&(Math.abs(g.w-auto.w)>0.6||(s.kind!=='table'&&Math.abs(g.h-auto.h)>0.6)));
  const placed=(d&&!d.implicit&&d.place)||moved||!d;
  return {id:s.id,kind:s.kind,label:s.label,columns:s.columns,attrs:s.attrs,
    place:placed?{x:g.x,y:g.y,w:sized?g.w:null,h:sized?(s.kind==='table'?tableH(s.columns):g.h):null}:null};
}
function withTail(old,canon){ const indent=(old.match(/^\s*/)||[''])[0], c=splitComment(old).comment; return indent+canon+(c?'  '+c.trim():''); }
/* write the model back into the text, rewriting only statements that changed */
export function syncFromModel(){
  if(!S.ast) return {};
  const L=S.text.split('\n'), repl=new Map(), del=new Set(), ins=new Map(), track={};
  const add=(after,text,tag)=>{ if(!ins.has(after)) ins.set(after,[]); ins.get(after).push({text,tag}); };
  S.pages.forEach((pg,pi)=>{
    const ap=S.ast.pages[pi]; if(!ap) return;
    const m=modelPage(pi), built=S.built[pi]||new Map(), seen=new Set(), seenE=new Set();
    const shapeAt=ap.lastShapeLine??ap.headerLine??ap.endLine, edgeAt=ap.lastEdgeLine??shapeAt;
    for(const s of m.shapes){
      const d=ap.byId.get(s.id), canon=shapeStmt(modelShapeObj(s,d,built)); seen.add(s.id);
      if(d&&!d.implicit){ if(canon!==shapeStmt(declObj(d))) repl.set(d.line,withTail(L[d.line],canon)); }
      else if(!d||canon!==shapeStmt(declObj(d))) add(shapeAt,canon);
    }
    for(const d of ap.shapes) if(!d.implicit&&!seen.has(d.id)) del.add(d.line);
    for(const e of m.edges){
      if(!e.from||!e.to||e.from===e.to) continue;
      const canon=edgeStmt(e), ae=e.key!=null?ap.edgeByLine.get(+e.key):null;
      if(ae&&!seenE.has(ae.line)){ seenE.add(ae.line); if(canon!==edgeStmt(ae)) repl.set(ae.line,withTail(L[ae.line],canon)); track[ae.line]={el:e.el}; }
      else add(edgeAt,canon,{el:e.el});
    }
    for(const ae of ap.edges) if(!seenE.has(ae.line)) del.add(ae.line);
    if(ap.key&&!m.key) del.add(ap.key.line);
    else if(m.key){
      const b=built.get('__key'), moved=!b||Math.abs(b.x-m.key.geo.x)>0.06||Math.abs(b.y-m.key.geo.y)>0.06;
      const k={title:m.key.title,place:(ap.key&&ap.key.place)||moved?{x:m.key.geo.x,y:m.key.geo.y}:null};
      if(ap.key){ const c=keyStmt(k); if(c!==keyStmt(ap.key)) repl.set(ap.key.line,withTail(L[ap.key.line],c)); } else add(shapeAt,keyStmt(k));
    }
  });
  const out=[], lineMap=new Map(), placedTags=new Map();
  const flush=after=>{ for(const it of ins.get(after)||[]){ if(it.tag) placedTags.set(it.tag.el,out.length); out.push(it.text); } };
  flush(-1);
  for(let i=0;i<L.length;i++){ if(!del.has(i)){ lineMap.set(i,out.length); out.push(repl.has(i)?repl.get(i):L[i]); } flush(i); }
  if(L.length===0) flush(0);
  S.text=out.join('\n');
  return {lineMap,placedTags,track};
}
