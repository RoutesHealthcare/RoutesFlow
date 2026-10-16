/* =====================================================================
   Text formats: Mermaid, PlantUML (component and activity), Graphviz DOT, draw.io.
   Every format converts to and from one neutral graph model:
     nodes: [{id, kind, label, columns?, x?, y?, w?, h?, fill?, line?, textColour?}]   (inches, y down)
     edges: [{from, to, label, directed, both}]
     direction ('TB'|'LR'|'BT'|'RL'), positioned (true when the source carried coordinates), warnings: []
   ===================================================================== */
import {NS, PX, S, colour, distToPolyline, kid, kids} from '../core.js';
import {cellV, is1D, num, rowV, shapeCtx, shapeText} from '../visio-package.js';
import {buildPaths, geomFor} from '../geometry.js';
import {pageCtx, render} from '../render.js';
import {listConnects} from '../connectors.js';
import {SHAPES, TABLE, roleOf, tableParts} from '../shapes.js';
import {connTag, edgeStyleOf, resolveType, textPt, userV} from '../flow/model.js';

export const FMT={
  mermaid:{name:'Mermaid flowchart',ext:'mmd',mime:'text/plain'},
  plantuml:{name:'PlantUML (component style)',ext:'puml',mime:'text/plain'},
  activity:{name:'PlantUML (activity diagram)',ext:'puml',suffix:'-activity',mime:'text/plain'},
  dot:{name:'Graphviz DOT',ext:'dot',mime:'text/vnd.graphviz'},
  drawio:{name:'draw.io',ext:'drawio',mime:'application/xml'},
  png:{name:'PNG image',ext:'png',mime:'image/png',binary:true,
    note:'A PNG is a picture of a page, not a diagram file: shapes, text and connections cannot be brought back in. One is made for every page; a drawing with more than one page comes back as a zip, with one PNG in it per page. Use Download to save it.'},
  pdf:{name:'PDF document',ext:'pdf',mime:'application/pdf',binary:true,
    note:'A PDF is a picture of every page, one per page, in a single document: shapes, text and connections cannot be brought back in. Use Download to save it.'}
};
export const MAX_IMPORT_CHARS=5e6, MAX_NODES=2000;
export const DRAWIO_PPI=100;   // draw.io's A4 page is 827 x 1169 units, i.e. 100 units per inch
export const clampN=(v,lo,hi,d)=>Number.isFinite(v)?Math.min(hi,Math.max(lo,v)):d;
export const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
export const fullLabel=n=>n.kind==='table'?[n.label,...(n.columns||[])].join('\n'):(n.label||'');

/* ---------- reading the current page into the graph model ---------- */
const MASTER_KINDS=[[/decision/i,'decision'],[/start|end|terminat/i,'terminator'],[/sub-?process|predefined/i,'subprocess'],
  [/multiple doc|documents/i,'multidoc'],[/document/i,'document'],[/database|data store|cylinder/i,'database'],[/^data\b|\bdata$/i,'data'],
  [/manual input/i,'manualInput'],[/manual op/i,'manualOp'],[/preparation/i,'preparation'],[/delay/i,'delay'],[/off-?page/i,'offPage'],
  [/circle|ellipse|on-?page/i,'ellipse'],[/cloud/i,'cloud'],[/sql|database|data store/i,'database'],[/server/i,'server'],[/user|person|actor/i,'user'],
  [/web design|code|api\b/i,'api'],[/ui ?ux|screen|monitor|browser|web page/i,'browser']];
/* Icon masters (SQL Server, Web design and so on) are groups of artwork; their colours belong to the artwork */
const iconMaster=el=>{ const sh=shapeCtx(el,null), ms=sh.mid&&S.masters[sh.mid];
  return el.getAttribute('Type')==='Group'&&!!(ms&&ms.name)&&MASTER_KINDS.some(([re])=>re.test(ms.name)); };
function kindOf(el){
  const r=roleOf(el);
  if(r==='table'||(SHAPES[r]&&!/^table(Header|Row)$/.test(r))) return r;
  const sh=shapeCtx(el,null), ms=sh.mid&&S.masters[sh.mid];
  if(ms&&ms.name) for(const [re,k] of MASTER_KINDS) if(re.test(ms.name)) return k;
  if(el.getAttribute('Type')==='Group') return 'process';
  if(num(sh,'LinePattern',1)===0&&num(sh,'FillPattern',1)===0) return 'text';
  const W=num(sh,'Width',1)||1, H=num(sh,'Height',1)||1, paths=buildPaths(sh,W,H);
  if(!paths.some(p=>p.subs.length&&(p.fill||p.line))) return 'text';
  if(geomFor(sh,W,H).some(sec=>[...sec.rows.values()].some(row=>row.t==='Ellipse'))) return 'ellipse';
  const pts=paths[0].subs[0]&&paths[0].subs[0].pts;
  if(pts&&pts.length===5){   // a closed four-point outline touching the middle of each side is a diamond
    const near=(q,x,y)=>Math.abs(q[0]-x)<W*0.03&&Math.abs(q[1]-y)<H*0.03;
    if([[W/2,0],[W,H/2],[W/2,H],[0,H/2]].every(m=>pts.some(q=>near(q,m[0],m[1])))) return 'decision';
  }
  return 'process';
}
/* The artwork of an icon shape as drawn on the canvas, as an SVG data URI. Text is left out: an icon's caption
   becomes the shape's label and is drawn under the picture. */
function iconPicture(id,b){
  const g=document.querySelector(`#layer > [data-id="${id}"]`); if(!g||b.x1-b.x0<1||b.y1-b.y0<1) return null;
  const c=g.cloneNode(true);
  for(const t of c.querySelectorAll('text')) t.remove();
  for(const p of c.querySelectorAll('path[fill="transparent"],path[stroke="transparent"]')) p.remove();   // hit areas
  if(!c.querySelector('path,circle,ellipse,rect,polygon,polyline,line')) return null;
  toIconOrigin(c,b.x0,b.y0);   // coordinates relative to the icon, so the same icon used twice gives the same picture
  const r=v=>+(v).toFixed(2), svgText=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(b.x1-b.x0)} ${r(b.y1-b.y0)}">${c.innerHTML}</svg>`;
  return 'data:image/svg+xml;base64,'+base64(new TextEncoder().encode(svgText));
}
function base64(bytes){ let s=''; for(let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(s); }
/* Moves drawn artwork so (x0,y0) becomes the origin. The renderer writes absolute M/L paths, circles and lines. */
function toIconOrigin(root,x0,y0){
  const fx=v=>(+v-x0).toFixed(1), fy=v=>(+v-y0).toFixed(1),   // 0.1 px: finer than the screen shows, coarse enough that copies match
    num='(-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?)';
  const pair=new RegExp(num+'[ ,]+'+num,'g');
  for(const p of root.querySelectorAll('path')) p.setAttribute('d',p.getAttribute('d').replace(pair,(_,x,y)=>fx(x)+' '+fy(y)));
  for(const el of root.querySelectorAll('*')) for(const [ax,ay] of [['cx','cy'],['x','y'],['x1','y1'],['x2','y2']]){
    if(el.hasAttribute(ax)) el.setAttribute(ax,fx(el.getAttribute(ax))); if(el.hasAttribute(ay)) el.setAttribute(ay,fy(el.getAttribute(ay))); }
}
/* Visio's dynamic connectors route at right angles unless set to straight (2) or centre to centre (16) */
function visioElbow(el,sh){
  const ms=sh.mid&&S.masters[sh.mid], rs=num(sh,'ShapeRouteStyle',0);
  if(rs===2||rs===16) return false;
  return !!(ms&&/dynamic connector/i.test(ms.name||''))||(S.lines[el.getAttribute('ID')]||[]).flat().length>2;
}
/* The corners of a connector as drawn, without its two ends, in inches. Visio draws a small arc where a line jumps
   over another and keeps it in the line's geometry; any point that strays less than JOG from the straight run
   between its neighbours is one of those (or a tiny jog) and is dropped. Corners that are nearly level are then
   squared up so the line stays right-angled. */
const JOG=0.06;   // inches
function bendsOf(id){
  const pts=(S.lines[id]||[]).flat().map(p=>[p[0]/PX,p[1]/PX]);
  const off=(p,a,b)=>distToPolyline([[a,b]],p[0],p[1]);
  for(let removed=true;removed;){ removed=false;
    for(let i=1;i<pts.length-1;i++) if(off(pts[i],pts[i-1],pts[i+1])<JOG){ pts.splice(i,1); removed=true; i--; } }
  for(let i=1;i<pts.length;i++){ const a=pts[i-1], b=pts[i];
    if(Math.abs(a[0]-b[0])<JOG) b[0]=a[0]; else if(Math.abs(a[1]-b[1])<JOG) b[1]=a[1]; }
  const corners=pts.slice(1,-1);
  return corners.length?corners:null;
}
export function pageGraph(){
  render();
  const pg=pageCtx(), top=kids(kid(pg.doc.documentElement,'Shapes'),'Shape'), cons=listConnects();
  const g={nodes:[],edges:[],direction:'TB',positioned:true,warnings:[]}, byId={}, topOf={};
  for(const t of top){ const id=t.getAttribute('ID'); topOf[id]=id; for(const c of t.getElementsByTagNameNS(NS,'Shape')) topOf[c.getAttribute('ID')]=id; }
  for(const el of top){
    const sh=shapeCtx(el,null), id=el.getAttribute('ID'), b=S.boxes[id];
    if(is1D(sh)||!b||roleOf(el)==='key') continue;
    const kind=kindOf(el), icon=iconMaster(el), n={id,kind,x:b.x0/PX,y:b.y0/PX,w:(b.x1-b.x0)/PX,h:(b.y1-b.y0)/PX,
      fill:icon?null:colour(cellV(sh,'FillForegnd',null),null),line:icon?null:colour(cellV(sh,'LineColor',null),null),
      textColour:icon?null:colour(rowV(sh,'Character','0','Color'),null),size:textPt(sh)};
    if(kind==='table'){ const p=tableParts(el); n.label=p.header?shapeText(shapeCtx(p.header,null)):''; n.columns=p.rows.map(r=>shapeText(shapeCtx(r,null))); }
    else if(el.getAttribute('Type')==='Group') n.label=[shapeText(sh),...[...el.getElementsByTagNameNS(NS,'Shape')].map(c=>shapeText(shapeCtx(c,sh.mid)))].filter(Boolean).join('\n');
    else n.label=shapeText(sh);
    if(kind==='text'&&!n.label.trim()) continue;
    const pic=icon?iconPicture(id,b):null;
    if(pic){ n.icon=pic; n.iconName=S.masters[sh.mid].name; n.iconKey=`${sh.mid}|${n.w.toFixed(2)}x${n.h.toFixed(2)}`; }   // one master at one size is one icon
    g.nodes.push(n); byId[id]=n;
  }
  const tol=0.15;   // inches: an unglued connector end this close to a shape counts as attached
  const nodeAt=(x,y)=>{ let best=null, area=Infinity;
    for(const n of g.nodes){ if(n.kind==='text') continue;
      if(x>=n.x-tol&&x<=n.x+n.w+tol&&y>=n.y-tol&&y<=n.y+n.h+tol&&n.w*n.h<area){ best=n.id; area=n.w*n.h; } }
    return best; };
  const connectors=top.filter(el=>is1D(shapeCtx(el,null)));
  const endOf=(el,e,depth=0)=>{
    const sh=shapeCtx(el,null), id=el.getAttribute('ID'), c=cons.find(c=>c.from===id&&c.fromCell===e+'X');
    if(c&&byId[topOf[c.to]]) return topOf[c.to];
    const x=num(sh,e+'X',NaN), y=pg.h-num(sh,e+'Y',NaN);
    const n=nodeAt(x,y); if(n||depth) return n;
    // a line that ends on another line joins it, and goes where that line goes (Visio draws merging branches this way)
    const onto=connectors.find(o=>o!==el&&distToPolyline(S.lines[o.getAttribute('ID')],x*PX,y*PX)<=tol*PX);
    return onto?endOf(onto,'End',1):null;
  };
  let loose=0, loops=0;
  for(const el of connectors){
    const sh=shapeCtx(el,null), id=el.getAttribute('ID');
    if(Math.hypot(num(sh,'EndX',0)-num(sh,'BeginX',0),num(sh,'EndY',0)-num(sh,'BeginY',0))<1e-3) continue;   // zero-length leftovers are invisible
    let from=endOf(el,'Begin'), to=endOf(el,'End');
    if(!from||!to){ loose++; continue; }
    if(from===to){ loops++; continue; }
    const st=edgeStyleOf(el);
    if(!st.route&&visioElbow(el,sh)) st.route='elbow';
    if(st.route==='elbow') st.via=bendsOf(id);   // inches from the page's top-left, like node positions
    g.edges.push({from,to,label:shapeText(sh).trim(),...st,directed:st.end!=='none'||st.start!=='none',both:st.start!=='none'&&st.end!=='none'});
  }
  const fidOf={}; for(const t of top){ const f=userV(t,'FlowId'); if(f) fidOf[t.getAttribute('ID')]=f; }   // export with the names used in the text
  for(const n of g.nodes) n.id=fidOf[n.id]||n.id; for(const e of g.edges){ e.from=fidOf[e.from]||e.from; e.to=fidOf[e.to]||e.to; }
  if(loose) g.warnings.push(`${plural(loose,'connector')} not attached to a shape at both ends ${loose===1?'was':'were'} left out.`);
  if(loops) g.warnings.push(`${plural(loops,'connector')} from a shape back to itself ${loops===1?'was':'were'} left out.`);
  return g;
}
const RESERVED_IDS=new Set(['end','graph','subgraph','flowchart','style','class','classdef','click','direction','linkstyle','default','start','stop','if','else','endif','node','edge','digraph','strict','note','as']);
/* identifiers every text format accepts; flow ids map onto them one to one, so editing in another format keeps positions */
export const exportIds=g=>{ const used=new Set(), m={};
  for(const n of g.nodes){ let b=String(n.id).replace(/[^A-Za-z0-9_]/g,'_'); if(!/^[A-Za-z_]/.test(b)) b='n_'+b; if(RESERVED_IDS.has(b.toLowerCase())) b+='_';
    let id=b, k=2; while(used.has(id)) id=`${b}_${k++}`; used.add(id); m[n.id]=id; }
  return m; };
const taggedLabel=e=>e.label?`${e.label} (${connTag(e)})`:`(${connTag(e)})`;

/* ---------- Mermaid ---------- */
const MM_CLASSIC={process:['[',']'],decision:['{','}'],terminator:['([','])'],data:['[/','/]'],subprocess:['[[',']]'],
  database:['[(',')]'],ellipse:['((','))'],preparation:['{{','}}'],manualOp:['[\\','/]']};
/* checked against Mermaid 11.12; person and browser only arrived in Mermaid 12, so those kinds export as rectangles with a class */
const MM_NEW={document:'doc',multidoc:'docs',manualInput:'sl-rect',delay:'delay',cloud:'cloud',text:'text',button:'stadium'};
const mmText=s=>s.replace(/"/g,'#quot;').replace(/\n/g,'<br/>');
function toMermaid(g){
  const id=exportIds(g), out=['%% Exported from Flow editor','flowchart TB'], cls={};
  let newSyntax=false;
  for(const n of g.nodes){
    const t=`"${mmText(fullLabel(n))}"`;
    if(MM_CLASSIC[n.kind]){ const [a,b]=MM_CLASSIC[n.kind]; out.push(`    ${id[n.id]}${a}${t}${b}`); }
    else if(MM_NEW[n.kind]){ out.push(`    ${id[n.id]}@{ shape: ${MM_NEW[n.kind]}, label: ${t} }`); newSyntax=true; }
    else out.push(`    ${id[n.id]}[${t}]`);
    // a class keeps the shape type for kinds Mermaid has no unique shape for, so importing restores them
    if(!MM_CLASSIC[n.kind]&&(!MM_NEW[n.kind]||n.kind==='button')) (cls[n.kind]=cls[n.kind]||[]).push(id[n.id]);
  }
  const MM_EXACT={flow:'-->',both:'<-->',assoc:'-.-',association:'---',alt:'-.->'};
  for(const e of g.edges){
    const t=resolveType(e), exact=MM_EXACT[t], head=e.end!=='none', tail=e.start!=='none', dash=e.style!=='solid';
    const arrow=exact||((tail&&head?'<':'')+(dash?(head?'-.->':'-.-'):(head?'-->':'---')));
    const label=exact?e.label:taggedLabel(e), lab=label?`|"${mmText(label).replace(/\|/g,'#124;')}"|`:'';   // quoted, so labels may start with a bracket
    out.push(`    ${id[e.from]} ${arrow}${lab} ${id[e.to]}`);
  }
  for(const k in cls) out.push(`    class ${cls[k].join(',')} fe_${k}`);
  if(newSyntax) g.warnings.push('Some shapes use the @{ shape: … } syntax, which needs Mermaid 11.3 or later.');
  return out.join('\n')+'\n';
}

/* ---------- PlantUML, component style ---------- */
const PU_EL={process:'rectangle',decision:'hexagon',database:'database',cloud:'cloud',user:'actor',server:'node',api:'component',
  document:'file',multidoc:'collections',preparation:'hexagon',ellipse:'usecase',text:'label'};
export const PU_NATIVE={rectangle:'process',hexagon:'preparation',database:'database',cloud:'cloud',actor:'user','actor/':'user',person:'user',
  node:'server',component:'api',file:'document',collections:'multidoc',usecase:'ellipse',label:'text',circle:'ellipse',storage:'database',
  folder:'document',artifact:'document',interface:'ellipse'};
const puText=s=>s.replace(/"/g,"'").replace(/\n/g,'\\n');
function toPlantUml(g){
  const id=exportIds(g), out=['@startuml',"' Exported from Flow editor"];
  for(const n of g.nodes){
    const el=PU_EL[n.kind]||'rectangle', st=PU_NATIVE[el]===n.kind?'':` <<${n.kind}>>`;
    out.push(`${el} "${puText(fullLabel(n))}"${st} as ${id[n.id]}`);
  }
  const PU_EXACT={flow:'-->',both:'<-->',assoc:'..',association:'--',dependency:'..>',generalisation:'--|>',realisation:'..|>',aggregation:'o--',composition:'*--'};
  for(const e of g.edges){
    const t=resolveType(e), exact=PU_EXACT[t], head=e.end!=='none', tail=e.start!=='none', dash=e.style!=='solid';
    const arrow=exact||((tail&&head?'<':'')+(dash?(head?'..>':'..'):(head?'-->':'--'))), label=exact?e.label:taggedLabel(e);
    out.push(`${id[e.from]} ${arrow} ${id[e.to]}${label?' : '+label.replace(/\n/g,'\\n'):''}`);
  }
  out.push('@enduml');
  if(g.nodes.some(n=>n.kind==='decision')) g.warnings.push('PlantUML component diagrams have no diamond, so decisions are hexagons marked «decision».');
  return out.join('\n')+'\n';
}

/* ---------- PlantUML, activity diagram ----------
   Activity syntax is structured (if/else, split), so the graph is walked from each start: a branch point emits
   if/elseif/else (or split) up to the nearest node every branch reaches. A link back to something already written
   cannot be expressed structurally and becomes a lettered connector circle at both ends. */
function toActivity(g){
  const nodes=g.nodes.filter(n=>n.kind!=='text'), byId=Object.fromEntries(nodes.map(n=>[n.id,n])), out={}, indeg={};
  for(const n of nodes){ out[n.id]=[]; indeg[n.id]=0; }
  for(const e0 of g.edges){ const e=resolveType(e0)==='flow'?e0:{...e0,label:taggedLabel(e0)}; if(byId[e.from]&&byId[e.to]){ out[e.from].push(e); indeg[e.to]++; } }
  const lines=[], at={}, done=new Set(), jumpName={}, targets=new Set(); let jumps=0;
  const pad=d=>'  '.repeat(d), clean=s=>s.replace(/[;()]/g,m=>m===';'?',':m==='('?'[':']');
  const lab=n=>clean(fullLabel(n)).trim()||' ';
  const isStart=n=>n.kind==='terminator'&&indeg[n.id]===0, isEnd=n=>n.kind==='terminator'&&!out[n.id].length;
  const plainStart=/^(start|begin)$/i, plainEnd=/^(end|stop|finish)$/i;
  const letters=k=>{ let s=''; k++; while(k>0){ const r=(k-1)%26; s=String.fromCharCode(65+r)+s; k=Math.floor((k-1)/26); } return s; };
  const reach=s=>{ const d=new Map([[s,0]]), q=[s]; while(q.length){ const c=q.shift(); for(const e of out[c]) if(!d.has(e.to)){ d.set(e.to,d.get(c)+1); q.push(e.to); } } return d; };
  const mergeOf=starts=>{ const maps=starts.map(reach); let best=null, bestD=Infinity;
    for(const [id,d0] of maps[0]){ if(done.has(id)) continue; let worst=d0, ok=true;
      for(const m of maps.slice(1)){ if(!m.has(id)){ ok=false; break; } worst=Math.max(worst,m.get(id)); }
      if(ok&&worst<bestD){ best=id; bestD=worst; } }
    return best; };
  const jump=(id,d)=>{ const j=jumpName[id]||(jumpName[id]=letters(jumps++)); targets.add(id); lines.push(pad(d)+`(${j})`,pad(d)+'detach'); };
  /* merge: where this branch rejoins its own if/split (the endif carries on from there).
     outer: merge points of enclosing blocks; reaching one of those directly cannot fall through, so it becomes a jump. */
  function seq(id,merge,outer,d){
    while(id&&id!==merge){
      const n=byId[id], outs=out[id];
      if(outer.has(id)){ jump(id,d); return; }
      if(done.has(id)){
        if(isEnd(n)&&plainEnd.test(lab(n))){ lines.push(pad(d)+'stop'); return; }
        jump(id,d); return;
      }
      done.add(id); at[id]=lines.length;
      if(outs.length>1){
        const m=mergeOf(outs.map(e=>e.to)), inner=new Set(outer); if(merge) inner.add(merge);
        if(n.kind==='decision'){
          outs.forEach((e,i)=>{ const l=e.label?` (${clean(e.label)})`:'';
            lines.push(pad(d)+(i===0?`if (${lab(n)}) then${l}`:i<outs.length-1?`elseif (${clean(e.label||'other')}) then`:`else${l}`));
            seq(e.to,m,inner,d+1); });
          lines.push(pad(d)+'endif');
        } else {
          lines.push(pad(d)+`:${lab(n)};`,pad(d)+'split');
          outs.forEach((e,i)=>{ if(i) lines.push(pad(d)+'split again'); if(e.label) lines.push(pad(d+1)+`-> ${clean(e.label)};`); seq(e.to,m,inner,d+1); });
          lines.push(pad(d)+'end split');
        }
        id=m; continue;
      }
      if(isStart(n)){ lines.push(pad(d)+'start'); if(!plainStart.test(lab(n))) lines.push(pad(d)+`:${lab(n)};`); }
      else if(isEnd(n)){ if(!plainEnd.test(lab(n))) lines.push(pad(d)+`:${lab(n)};`); lines.push(pad(d)+'stop'); return; }
      else lines.push(pad(d)+(n.kind==='decision'?`if (${lab(n)}) then`:`:${lab(n)};`));
      if(n.kind==='decision'){   // a decision with one way out still needs its endif
        if(!outs.length){ lines.push(pad(d)+'endif'); return; }
        if(outs[0].label) lines.push(pad(d+1)+`-> ${clean(outs[0].label)};`);
        seq(outs[0].to,merge,outer,d+1); lines.push(pad(d)+'else',pad(d+1)+'detach',pad(d)+'endif'); return;   // no implied second way out
      }
      if(!outs.length){ lines.push(pad(d)+'stop'); return; }
      if(outs[0].label) lines.push(pad(d)+`-> ${clean(outs[0].label)};`);
      id=outs[0].to;
    }
  }
  const run=n=>{ if(done.has(n.id)) return; if(lines.length) lines.push(''); if(!isStart(n)) lines.push('start'); seq(n.id,null,new Set(),0); };
  nodes.filter(isStart).forEach(run); nodes.filter(n=>!indeg[n.id]).forEach(run); nodes.forEach(run);
  // connector circles before each jump target, inserted from the bottom up so earlier indexes stay valid
  [...targets].sort((a,b)=>at[b]-at[a]).forEach(id=>{ const ind=lines[at[id]].match(/^\s*/)[0]; lines.splice(at[id],0,ind+`(${jumpName[id]})`); });
  if(jumps) g.warnings.push(`${plural(jumps,'link')} back to an earlier step ${jumps===1?'is':'are'} shown as lettered connector circles, because activity diagrams cannot draw them directly.`);
  const free=g.nodes.length-nodes.length; if(free) g.warnings.push(`${plural(free,'free-text label')} ${free===1?'has':'have'} no place in an activity diagram and ${free===1?'was':'were'} left out.`);
  return ['@startuml',"' Exported from Flow editor",...lines,'@enduml'].join('\n')+'\n';
}

/* ---------- Graphviz DOT ---------- */
const DOT_SHAPE={process:'box',decision:'diamond',terminator:'box',data:'parallelogram',subprocess:'box',database:'cylinder',ellipse:'ellipse',
  document:'note',multidoc:'note',manualInput:'box',manualOp:'invtrapezium',preparation:'hexagon',delay:'box',offPage:'invhouse',cloud:'ellipse',
  user:'box',server:'box3d',api:'component',text:'plaintext',table:'record',browser:'box',mobile:'box',field:'box',button:'box',dropdown:'box',checkbox:'box'};
const dotStr=s=>'"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n')+'"';
const recEsc=s=>s.replace(/[\\{}|<>"]/g,m=>'\\'+m).replace(/\n/g,'\\l');
function toDot(g){
  const id=exportIds(g), out=['// Exported from Flow editor','digraph G {','  rankdir=TB;','  node [fontname="Calibri", fontsize=11];','  edge [fontname="Calibri", fontsize=10];'];
  for(const n of g.nodes){
    const a=[`shape=${DOT_SHAPE[n.kind]||'box'}`];
    if(n.kind==='table') a.push(`label="{${recEsc(n.label||'table')}|${(n.columns||[]).map(c=>recEsc(c)+'\\l').join('')}}"`);
    else a.push('label='+dotStr(n.label||''));
    if(n.kind==='terminator'||n.kind==='button') a.push('style=rounded');
    a.push(`comment="flow-editor:${n.kind}"`);   // restores the exact shape type on import; Graphviz ignores it
    out.push(`  ${id[n.id]} [${a.join(', ')}];`);
  }
  const DOT_M={none:'none',arrow:'normal',open:'vee',triangle:'onormal',diamond:'odiamond',fdiamond:'diamond',circle:'odot',one:'teetee',zeroOne:'teeodot',oneMany:'crowtee',zeroMany:'crowodot'};
  for(const e of g.edges){
    const a=[]; if(e.label) a.push('label='+dotStr(e.label)); if(e.style&&e.style!=='solid') a.push('style='+e.style);
    if(e.start&&e.start!=='none') a.push('dir=both',`arrowtail=${DOT_M[e.start]}`,`arrowhead=${DOT_M[e.end]}`);
    else if(e.end==='none') a.push('dir=none'); else if(e.end&&e.end!=='arrow') a.push(`arrowhead=${DOT_M[e.end]}`);
    out.push(`  ${id[e.from]} -> ${id[e.to]}${a.length?' ['+a.join(', ')+']':''};`);
  }
  out.push('}'); return out.join('\n')+'\n';
}

/* ---------- draw.io ---------- */
const DIO_STYLE={process:'rounded=0;',decision:'rhombus;',terminator:'rounded=1;arcSize=50;',data:'shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;',
  subprocess:'shape=process;backgroundOutline=1;',database:'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=15;',ellipse:'ellipse;',
  document:'shape=document;boundedLbl=1;',multidoc:'shape=mxgraph.flowchart.multi-document;',manualInput:'shape=manualInput;',
  manualOp:'shape=trapezoid;perimeter=trapezoidPerimeter;fixedSize=1;flipV=1;',preparation:'shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;',
  delay:'shape=delay;',offPage:'shape=offPageConnector;',cloud:'ellipse;shape=cloud;',
  user:'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;outlineConnect=0;',api:'shape=component;align=left;spacingLeft=36;',
  text:'text;strokeColor=none;fillColor=none;',button:'rounded=1;arcSize=50;'};
export const xmlEsc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'&#10;');
const htmlLabel=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
function toDrawio(g){
  const P=v=>Math.round(v*DRAWIO_PPI), pg=pageCtx(), cells=[], id={};
  g.nodes.forEach((n,i)=>id[n.id]='n'+(i+1));
  const col=n=>(n.fill?`fillColor=${n.fill};`:'')+(n.line?`strokeColor=${n.line};`:'')+(n.textColour?`fontColor=${n.textColour};`:'');
  const cell=(cid,value,style,attrs,geo)=>`<mxCell id="${cid}" value="${xmlEsc(htmlLabel(value))}" style="${xmlEsc(style)}" ${attrs}>${geo}</mxCell>`;
  for(const n of g.nodes){
    const geo=`<mxGeometry x="${P(n.x)}" y="${P(n.y)}" width="${P(n.w)}" height="${P(n.h)}" as="geometry"/>`;
    if(n.kind==='table'){
      const cols=n.columns||[], hh=P(TABLE.headerH), rh=Math.max(1,Math.round((P(n.h)-hh)/Math.max(1,cols.length)));
      cells.push(cell(id[n.id],n.label||'','swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize='+hh+';horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;html=1;flowEditorKind=table;'+col(n),'vertex="1" parent="1"',geo));
      cols.forEach((c,i)=>cells.push(cell(`${id[n.id]}r${i+1}`,c,'text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=4;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;html=1;',
        `vertex="1" parent="${id[n.id]}"`,`<mxGeometry y="${hh+i*rh}" width="${P(n.w)}" height="${rh}" as="geometry"/>`)));
      continue;
    }
    cells.push(cell(id[n.id],n.label||'',(DIO_STYLE[n.kind]||'rounded=0;')+'whiteSpace=wrap;html=1;flowEditorKind='+n.kind+';'+col(n),'vertex="1" parent="1"',geo));
  }
  g.edges.forEach((e,i)=>cells.push(cell(`e${i+1}`,e.label||'',
    'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;'+dioEnds(e),
    `edge="1" parent="1" source="${id[e.from]}" target="${id[e.to]}"`,'<mxGeometry relative="1" as="geometry"/>')));
  return `<mxfile host="Flow editor">\n  <diagram name="${xmlEsc(pg.name)}" id="flow-editor-1">\n    <mxGraphModel grid="1" gridSize="10" guides="1" connect="1" arrows="1" page="1" pageScale="1" pageWidth="${P(pg.pageW)}" pageHeight="${P(pg.pageH)}">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n${cells.map(c=>'        '+c).join('\n')}\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n`;
}
const DIO_M={none:['none',null],arrow:['block',1],open:['open',null],triangle:['block',0],diamond:['diamond',0],fdiamond:['diamond',1],circle:['oval',0],
  one:['ERmandOne',null],zeroOne:['ERzeroToOne',null],oneMany:['ERoneToMany',null],zeroMany:['ERzeroToMany',null]};
const dioEnds=e=>{ const [ea,ef]=DIO_M[e.end||'arrow'], [sa,sf]=DIO_M[e.start||'none'];
  return `endArrow=${ea};`+(ef!=null?`endFill=${ef};`:'')+`startArrow=${sa};`+(sf!=null?`startFill=${sf};`:'')+(e.style==='dashed'?'dashed=1;':e.style==='dotted'?'dashed=1;dashPattern=1 4;':'')+(e.stroke?`strokeColor=${e.stroke};`:''); };
export function dioMarker(a,fill){ a=String(a||'none').toLowerCase();
  if(/^(block|classic)(thin)?$/.test(a)) return fill==='0'?'triangle':'arrow';
  if(/^open/.test(a)) return 'open'; if(/^diamond/.test(a)) return fill==='0'?'diamond':'fdiamond'; if(/^(oval|circle|dot)/.test(a)) return 'circle';
  return {ermandone:'one',erone:'one',erzerotoone:'zeroOne',eronetomany:'oneMany',erzerotomany:'zeroMany',ermany:'zeroMany',none:'none'}[a]||'arrow'; }
export let EXPORTERS;

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  EXPORTERS={mermaid:toMermaid,plantuml:toPlantUml,activity:toActivity,dot:toDot,drawio:toDrawio};
}
