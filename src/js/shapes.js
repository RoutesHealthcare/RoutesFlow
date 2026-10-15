/* ---------- editing operations ---------- */
import {DEF, NS, PX, S, cellEl, evalF, fmtV, kid, kids, mk, setCell, snapIn, toast} from './core.js';
import {numEl, setText} from './visio-package.js';
import {axisOf} from './geometry.js';
import {pageCtx, render} from './render.js';
import {centreOf, refreshConnector, refreshFor, setGlue} from './connectors.js';
import {setEdgeStyle, setUser, userV} from './flow/model.js';
import {commit} from './document.js';

export function nextId(doc){ let m=0; for(const s of doc.getElementsByTagNameNS(NS,'Shape')) m=Math.max(m,+s.getAttribute('ID')||0); return String(m+1); }
export function ensureShapes(doc){ const root=doc.documentElement; let s=kid(root,'Shapes'); if(!s){ s=doc.createElementNS(NS,'Shapes'); root.insertBefore(s,root.firstChild); } return s; }
const rowsFrom=(pts)=>pts.map((p,i)=>({t:p[2]||(i?'LineTo':'MoveTo'),fx:p[0],fy:p[1]}));
const fracGeo=(...sections)=>(W,H)=>sections.map(sec=>({noFill:sec.noFill,rows:rowsFrom(sec.pts).map(r=>({t:r.t,c:[['X',W*r.fx,`Width*${r.fx}`],['Y',H*r.fy,`Height*${r.fy}`]]}))}));
const RECT=[[0,0],[1,0],[1,1],[0,1],[0,0]];
/* Curved outlines are sampled into LineTo rows with Width and Height formulas so they resize in Visio as well as here */
const r4=v=>Math.round(v*1e4)/1e4;
const arcPts=(cx,cy,rx,ry,a0,a1,n=16)=>Array.from({length:n+1},(_,i)=>{ const t=(a0+(a1-a0)*i/n)*Math.PI/180; return [r4(cx+rx*Math.cos(t)),r4(cy+ry*Math.sin(t))]; });
const wavePts=(x0,x1,y,amp,n=24)=>Array.from({length:n+1},(_,i)=>{ const t=i/n; return [r4(x1-(x1-x0)*t),r4(y+amp*Math.sin(2*Math.PI*t))]; });
const boxPts=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
const linePts=(...segs)=>segs.flatMap(([x0,y0,x1,y1])=>[[x0,y0,'MoveTo'],[x1,y1]]);
const CYL=0.12;
const roundedEnds=(W,H)=>{ const r=H/2; return [{rows:[
    {t:'MoveTo',c:[['X',r,'Height*0.5'],['Y',0,'Height*0']]},
    {t:'LineTo',c:[['X',W-r,'Width-Height*0.5'],['Y',0,'Height*0']]},
    {t:'ArcTo',c:[['X',W-r,'Width-Height*0.5'],['Y',H,'Height*1'],['A',r,'Height*0.5']]},
    {t:'LineTo',c:[['X',r,'Height*0.5'],['Y',H,'Height*1']]},
    {t:'ArcTo',c:[['X',r,'Height*0.5'],['Y',0,'Height*0'],['A',r,'Height*0.5']]}]}]; };
export const TABLE={w:2,headerH:0.35,rowH:0.3,columns:['id','name','created_at'],headerFill:'#1F6F78'};
/* Shape options: w,h inches; geo; bare = no line or fill; text = default label; align = 0 left, 1 centre, 2 right;
   txt = text block {x,y,w,h} as fractions of the shape; fill / textColour / bold override the defaults */
export let SHAPES;

/* Role tag stored in a User-defined cell, so it survives a round trip through Visio (shape names must be unique per page) */
const ROLE_ROW='FlowEditorRole';
export function roleOf(el){ return userV(el,ROLE_ROW); }
export function setRole(el,role){ setUser(el,ROLE_ROW,role); }

/* Build a shape element; L,B,W,H are in the parent's coordinates (the page, or a group's local space) */
export function buildShape(doc,kind,id,L,B,W,H,text){
  const T=SHAPES[kind], tb=Object.assign({x:0.5,y:0.5,w:1,h:1},T.txt);
  const el=mk(doc,'Shape',{ID:id,Type:'Shape',LineStyle:'0',FillStyle:'0',TextStyle:'0'});
  const C=(n,v,f,u)=>el.appendChild(cellEl(doc,n,v,f,u));
  C('PinX',L+W/2,null,'MM'); C('PinY',B+H/2,null,'MM'); C('Width',W,null,'MM'); C('Height',H,null,'MM');
  C('LocPinX',W/2,'Width*0.5','MM'); C('LocPinY',H/2,'Height*0.5','MM'); C('Angle',0,null,'DEG'); C('FlipX',0); C('FlipY',0); C('ResizeMode',0);
  C('LineWeight',1/72,null,'PT'); C('LineColor',DEF.line); C('LinePattern',T.bare?0:1);
  C('FillForegnd',T.fill||DEF.fill); C('FillPattern',T.bare?0:1);
  C('TxtPinX',W*tb.x,`Width*${tb.x}`,'MM'); C('TxtPinY',H*tb.y,`Height*${tb.y}`,'MM');
  C('TxtWidth',W*tb.w,`Width*${tb.w}`,'MM'); C('TxtHeight',H*tb.h,`Height*${tb.h}`,'MM');
  C('TxtLocPinX',W*tb.w/2,'TxtWidth*0.5','MM'); C('TxtLocPinY',H*tb.h/2,'TxtHeight*0.5','MM'); C('TxtAngle',0,null,'DEG'); C('VerticalAlign',1);
  const chr=[cellEl(doc,'Color',T.textColour||DEF.text),cellEl(doc,'Size',0.1527778,null,'PT')];
  if(T.bold) chr.push(cellEl(doc,'Style',1));
  el.appendChild(mk(doc,'Section',{N:'Character'},[mk(doc,'Row',{IX:'0'},chr)]));
  el.appendChild(mk(doc,'Section',{N:'Paragraph'},[mk(doc,'Row',{IX:'0'},[cellEl(doc,'HorzAlign',T.align??1)])]));
  T.geo(W,H).forEach((g,i)=>el.appendChild(mk(doc,'Section',{N:'Geometry',IX:String(i)},[
    cellEl(doc,'NoFill',g.noFill?1:0),cellEl(doc,'NoLine',0),cellEl(doc,'NoShow',0),cellEl(doc,'NoSnap',0),
    ...g.rows.map((r,j)=>mk(doc,'Row',{T:r.t,IX:String(j+1)},r.c.map(c=>cellEl(doc,c[0],c[1],c[2],'MM'))))])));
  setRole(el,kind);
  const label=text??T.text; if(label) setText(el,label);
  return el;
}
export function addShape(kind,x,y){
  const T=SHAPES[kind]; if(T.table) return addTable(x,y);
  const doc=pageCtx().doc, id=nextId(doc), W=T.w, H=T.h;
  ensureShapes(doc).appendChild(buildShape(doc,kind,id,snapIn(x-W/2),snapIn(y-H/2),W,H));
  return id;
}

/* ---------- database tables: a group holding a header shape and one shape per column ---------- */
export const isTable=el=>!!el&&el.getAttribute('Type')==='Group'&&roleOf(el)==='table';
export function tableParts(el){
  const all=kids(kid(el,'Shapes'),'Shape');
  return {all,header:all.find(c=>roleOf(c)==='tableHeader')||null,
    rows:all.filter(c=>roleOf(c)==='tableRow').sort((a,b)=>numEl(b,'PinY',0)-numEl(a,'PinY',0))};
}
/* Build a table group with ids firstId, firstId+1, ...; L,B,W in page inches */
export function buildTable(doc,firstId,L,B,W,name,columns){
  const {headerH,rowH}=TABLE, H=headerH+rowH*columns.length; let next=firstId;
  const g=mk(doc,'Shape',{ID:String(next++),Type:'Group',LineStyle:'0',FillStyle:'0',TextStyle:'0'});
  const C=(n,v,f,u)=>g.appendChild(cellEl(doc,n,v,f,u));
  C('PinX',L+W/2,null,'MM'); C('PinY',B+H/2,null,'MM'); C('Width',W,null,'MM'); C('Height',H,null,'MM');
  C('LocPinX',W/2,'Width*0.5','MM'); C('LocPinY',H/2,'Height*0.5','MM'); C('Angle',0,null,'DEG'); C('FlipX',0); C('FlipY',0);
  setRole(g,'table');
  const inner=doc.createElementNS(NS,'Shapes'); g.appendChild(inner);
  const part=(kind,b,h,text)=>inner.appendChild(buildShape(doc,kind,String(next++),0,b,W,h,text));
  part('tableHeader',H-headerH,headerH,name);
  columns.forEach((col,i)=>part('tableRow',H-headerH-rowH*(i+1),rowH,col));
  return g;
}
export const tableHeight=cols=>TABLE.headerH+TABLE.rowH*cols;
function addTable(x,y){
  const doc=pageCtx().doc, H=tableHeight(TABLE.columns.length), id=nextId(doc);
  ensureShapes(doc).appendChild(buildTable(doc,+id,snapIn(x-TABLE.w/2),snapIn(y-H/2),TABLE.w,'table_name',TABLE.columns));
  return id;
}
/* Grow or shrink a table by one row at the bottom, keeping its top edge fixed */
export function resizeTable(id,add){
  const el=S.elById[id]; if(!isTable(el)) return;
  const {all,rows}=tableParts(el), last=rows[rows.length-1];
  if(!add&&rows.length<=1){ toast('A table needs at least one row.'); return; }
  const rh=last?numEl(last,'Height',TABLE.rowH):TABLE.rowH, d=add?rh:-rh;
  const W=numEl(el,'Width',TABLE.w), H=numEl(el,'Height',1), bottom=numEl(el,'PinY',0)-numEl(el,'LocPinY',H/2), nH=H+d;
  commit(()=>{
    if(!add) last.remove();
    for(const c of all) if(add||c!==last) setCell(c,'PinY',numEl(c,'PinY',0)+d);
    setCell(el,'Height',nH); setCell(el,'LocPinY',nH/2,'Height*0.5'); setCell(el,'PinY',bottom-d+nH/2);
    if(add){ const doc=pageCtx().doc, r=buildShape(doc,'tableRow',nextId(doc),0,0,W,rh,'column'); kid(el,'Shapes').appendChild(r); }
    render(); refreshFor(id);
  });
}
/* begin, end: [x,y] in page inches */
export function buildConnector(doc,id,begin,end){
  const el=mk(doc,'Shape',{ID:id,Type:'Shape',LineStyle:'0',FillStyle:'0',TextStyle:'0'});
  const C=(n,v,f,u)=>el.appendChild(cellEl(doc,n,v,f,u));
  C('BeginX',begin[0],null,'MM'); C('BeginY',begin[1],null,'MM'); C('EndX',end[0],null,'MM'); C('EndY',end[1],null,'MM');
  C('ObjType',2); C('ShapeRouteStyle',16); C('ConLineRouteExt',1);
  C('LineWeight',1/72,null,'PT'); C('LineColor',DEF.line); C('LinePattern',1); C('FillPattern',0);
  C('EndArrow',13); C('EndArrowSize',2); C('BeginArrow',0);
  el.appendChild(mk(doc,'Section',{N:'Character'},[mk(doc,'Row',{IX:'0'},[cellEl(doc,'Color',DEF.text),cellEl(doc,'Size',0.125,null,'PT')])]));
  return el;
}
export const pxToIn=(q,pg)=>[q[0]/PX,pg.h-q[1]/PX];
export function addConnector(fromId,toId,endIn){
  const pg=pageCtx(), doc=pg.doc, id=nextId(doc);
  const el=buildConnector(doc,id,pxToIn(centreOf(fromId),pg),endIn); setEdgeStyle(el,S.newConn); ensureShapes(doc).appendChild(el);
  setGlue(id,'Begin',fromId); if(toId) setGlue(id,'End',toId);
  render(); refreshConnector(id);
  return id;
}
function recompute(el,W,H,sx,sy){
  for(const c of kids(el,'Cell')){
    const n=c.getAttribute('N'); if(['Width','Height','PinX','PinY'].includes(n)) continue;
    const ev=evalF(c.getAttribute('F'),W,H);
    if(ev!=null) c.setAttribute('V',fmtV(ev));
    else if(/^Txt(PinX|Width|LocPinX)$/.test(n)) c.setAttribute('V',fmtV(+c.getAttribute('V')*sx));
    else if(/^Txt(PinY|Height|LocPinY)$/.test(n)) c.setAttribute('V',fmtV(+c.getAttribute('V')*sy));
  }
  for(const s of kids(el,'Section')) if(s.getAttribute('N')==='Geometry') for(const r of kids(s,'Row')){
    const t=r.getAttribute('T');
    for(const c of kids(r,'Cell')){
      const ev=evalF(c.getAttribute('F'),W,H); if(ev!=null){ c.setAttribute('V',fmtV(ev)); continue; }
      const ax=axisOf(t,c.getAttribute('N')); if(ax) c.setAttribute('V',fmtV(+c.getAttribute('V')*(ax==='x'?sx:sy)));
    }
  }
}
export function applySize(el,W,H,W0,H0,lx,ly){
  setCell(el,'Width',W); setCell(el,'Height',H);
  setCell(el,'LocPinX',(W0?lx/W0:0.5)*W,null); setCell(el,'LocPinY',(H0?ly/H0:0.5)*H,null);
  recompute(el,W,H,W0?W/W0:1,H0?H/H0:1);
}

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  SHAPES={
    process:{w:1.5,h:0.75,geo:fracGeo({pts:RECT})},
    decision:{w:1.5,h:1,geo:fracGeo({pts:[[0.5,0],[1,0.5],[0.5,1],[0,0.5],[0.5,0]]})},
    data:{w:1.5,h:0.75,geo:fracGeo({pts:[[0,0],[0.8,0],[1,1],[0.2,1],[0,0]]})},
    subprocess:{w:1.5,h:0.75,geo:fracGeo({pts:RECT},{noFill:1,pts:linePts([0.1,0,0.1,1],[0.9,0,0.9,1])})},
    terminator:{w:1.5,h:0.6,geo:roundedEnds},
    ellipse:{w:1.2,h:0.8,geo:(W,H)=>[{rows:[{t:'Ellipse',c:[['X',W/2,'Width*0.5'],['Y',H/2,'Height*0.5'],['A',W,'Width*1'],['B',H/2,'Height*0.5'],['C',W/2,'Width*0.5'],['D',H,'Height*1']]}]}]},
    text:{w:1.5,h:0.4,bare:true,text:'Text',geo:()=>[]},
    document:{w:1.5,h:0.85,txt:{y:0.58,h:0.8},geo:fracGeo({pts:[[0,0.12],[0,1],[1,1],[1,0.12],...wavePts(0,1,0.12,0.1).slice(1)]})},
    multidoc:{w:1.6,h:0.95,txt:{x:0.43,y:0.5,w:0.86,h:0.7},geo:fracGeo(
      {pts:[[0,0.12],[0,0.84],[0.86,0.84],[0.86,0.12],...wavePts(0,0.86,0.12,0.09).slice(1)]},
      {noFill:1,pts:[[0.07,0.84,'MoveTo'],[0.07,0.92],[0.93,0.92],[0.93,0.2],[0.86,0.2],[0.14,0.92,'MoveTo'],[0.14,1],[1,1],[1,0.28],[0.93,0.28]]})},
    manualInput:{w:1.5,h:0.75,txt:{y:0.42,h:0.84},geo:fracGeo({pts:[[0,0],[1,0],[1,1],[0,0.7],[0,0]]})},
    manualOp:{w:1.5,h:0.75,geo:fracGeo({pts:[[0,1],[1,1],[0.85,0],[0.15,0],[0,1]]})},
    preparation:{w:1.5,h:0.75,geo:fracGeo({pts:[[0.15,0],[0.85,0],[1,0.5],[0.85,1],[0.15,1],[0,0.5],[0.15,0]]})},
    delay:{w:1.3,h:0.75,geo:fracGeo({pts:[[0,0],[0.5,0],...arcPts(0.5,0.5,0.5,0.5,-90,90).slice(1),[0,1],[0,0]]})},
    offPage:{w:0.8,h:0.8,txt:{y:0.62,h:0.7},geo:fracGeo({pts:[[0,1],[1,1],[1,0.4],[0.5,0],[0,0.4],[0,1]]})},
    database:{w:1.2,h:1.1,txt:{y:0.44,h:0.7},geo:fracGeo(
      {pts:[[0,1-CYL],[0,CYL],...arcPts(0.5,CYL,0.5,CYL,180,360).slice(1),[1,1-CYL],...arcPts(0.5,1-CYL,0.5,CYL,0,180).slice(1)]},
      {noFill:1,pts:arcPts(0.5,1-CYL,0.5,CYL,180,360)})},
    table:{w:TABLE.w,h:TABLE.headerH+TABLE.rowH*TABLE.columns.length,table:true},
    tableHeader:{w:TABLE.w,h:TABLE.headerH,fill:TABLE.headerFill,textColour:'#FFFFFF',bold:true,geo:fracGeo({pts:RECT})},
    tableRow:{w:TABLE.w,h:TABLE.rowH,align:0,geo:fracGeo({pts:RECT})},
    browser:{w:3,h:2,text:'Page content',txt:{y:0.42,h:0.84},geo:fracGeo({pts:RECT},{noFill:1,pts:linePts([0,0.85,1,0.85])},{pts:boxPts(0.2,0.88,0.96,0.97)})},
    mobile:{w:1,h:1.9,text:'Screen',geo:fracGeo({pts:RECT},{noFill:1,pts:[...boxPts(0.07,0.08,0.93,0.92).map((q,i)=>i?q:[...q,'MoveTo']),...linePts([0.38,0.96,0.62,0.96])]})},
    field:{w:2,h:0.35,text:'Text field',align:0,geo:fracGeo({pts:RECT})},
    button:{w:1.2,h:0.4,text:'Button',geo:roundedEnds},
    dropdown:{w:2,h:0.35,text:'Select…',align:0,txt:{x:0.44,w:0.88},geo:fracGeo({pts:RECT},{noFill:1,pts:[[0.9,0.62,'MoveTo'],[0.93,0.38],[0.96,0.62]]})},
    checkbox:{w:1.6,h:0.3,text:'Checkbox',align:0,txt:{x:0.58,w:0.82},geo:fracGeo({pts:boxPts(0,0.17,0.125,0.83)})},
    server:{w:0.6,h:1,txt:{y:-0.18,w:2.4,h:0.3},geo:fracGeo({pts:RECT},{noFill:1,pts:linePts([0,0.75,1,0.75],[0,0.5,1,0.5],[0.2,0.15,0.45,0.15])})},
    cloud:{w:1.6,h:1,geo:fracGeo({pts:Array.from({length:65},(_,i)=>{ const t=2*Math.PI*i/64, f=0.86+0.14*Math.abs(Math.sin(3.5*t)); return [r4(0.5+0.5*f*Math.cos(t)),r4(0.5+0.5*f*Math.sin(t))]; })})},
    user:{w:0.6,h:0.8,txt:{y:-0.16,w:2.4,h:0.3},geo:fracGeo({pts:arcPts(0.5,0.76,0.24,0.18,0,360,32)},{pts:[...arcPts(0.5,0,0.45,0.5,180,0,24),[0.05,0]]})},
    api:{w:1.6,h:0.8,txt:{x:0.56,w:0.84},geo:fracGeo({pts:boxPts(0.12,0,1,1)},{pts:boxPts(0,0.62,0.24,0.78)},{pts:boxPts(0,0.22,0.24,0.38)})}
  };
}
