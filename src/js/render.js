/* ---------- rendering ---------- */
import {$, colour, DEF, kid, kids, NS, PX, readableText, S, stage, svgEl} from './core.js';
import {cellV, is1D, num, numEl, rowV, shapeCtx, shapeText} from './visio-package.js';
import {ap, buildPaths, localMatrix, mul} from './geometry.js';
import {HIT_PAD_PX, HIT_TOL_PX, syncSelection} from './selection.js';
import {commitText} from './text-editor.js';
import {drawHover} from './pointer.js';
import {updateProps} from './properties.js';
import {drawMarker, markerOf, userV} from './flow/model.js';
import {routePoints} from './connectors.js';
import {addPage} from './visio-io.js';
import {refreshEditor} from './text-pane.js';

export const pageCtx=()=>S.pages[S.pi];
function dash(lp,lw){ const w=Math.max(lw,1); if(lp<=1) return null; if(lp===2) return `${w*4} ${w*3}`; if(lp===3) return `${w} ${w*2.5}`; return `${w*6} ${w*3} ${w} ${w*3}`; }
function arrowHead(from,tip,sz,col){
  const dx=tip[0]-from[0], dy=tip[1]-from[1], L=Math.hypot(dx,dy)||1, ux=dx/L, uy=dy/L;
  const bx=tip[0]-ux*sz, by=tip[1]-uy*sz, w=sz*0.42;
  return svgEl('path',{d:`M${tip[0]} ${tip[1]}L${bx-uy*w} ${by+ux*w}L${bx+uy*w} ${by-ux*w}Z`,fill:col,stroke:'none'});
}
const FONT='Calibri, "Segoe UI", Arial, sans-serif';
let measureCtx=null; const widths=new Map();
/* Width of a string in px at font size fs, measured with the font the canvas draws in (cached) */
function textWidth(str,fs,bold){
  const key=`${bold?1:0}|${fs}|${str}`; let w=widths.get(key);
  if(w==null){
    measureCtx=measureCtx||document.createElement('canvas').getContext('2d');
    measureCtx.font=`${bold?'bold ':''}${fs}px ${FONT}`; w=measureCtx.measureText(str).width;
    if(widths.size>20000) widths.clear(); widths.set(key,w);
  }
  return w;
}
/* Breaks text into lines no wider than maxW. A word is only split when it is wider than a line on its own. */
function wrap(t,maxW,fs,bold=false){
  const out=[], fits=s=>textWidth(s,fs,bold)<=maxW;
  for(const para of t.split('\n')){
    let line='';
    for(const w of para.split(/\s+/)){ if(!w) continue;
      const tryLine=line?line+' '+w:w;
      if(fits(tryLine)){ line=tryLine; continue; }
      if(line) out.push(line);
      line=w;
      while(!fits(line)&&line.length>1){ let n=line.length-1; while(n>1&&!fits(line.slice(0,n))) n--; out.push(line.slice(0,n)); line=line.slice(n); }
    }
    out.push(line);
  }
  return out;
}
function drawShape(el,parentM,inheritMid,g){
  const sh=shapeCtx(el,inheritMid), id=el.getAttribute('ID');
  const W=num(sh,'Width',0), H=num(sh,'Height',0), m=mul(parentM,localMatrix(sh)), oneD=is1D(sh);
  const lp=num(sh,'LinePattern',1), fp=num(sh,'FillPattern',1);
  const lc=colour(cellV(sh,'LineColor',null),'#000000'), fc=colour(cellV(sh,'FillForegnd',null),'#FFFFFF');
  const lw=Math.max(num(sh,'LineWeight',0.01)*PX,0.6);
  const corners=[[0,0],[W,0],[W,H],[0,H]].map(q=>ap(m,q[0],q[1]));
  const icon=!oneD&&iconFor(el); if(icon){ drawIconShape(sh,g,id,corners,icon); return; }
  if(!oneD) g.appendChild(svgEl('path',{d:'M'+corners.map(q=>q.join(' ')).join('L')+'Z',fill:'transparent',stroke:'transparent',
    'stroke-width':HIT_PAD_PX*2,'vector-effect':'non-scaling-stroke'}));
  const all=[], polys=[], open=[]; let hit='';
  for(const p of buildPaths(sh,W,H)){
    let df='', ds='';
    for(const sub of p.subs){
      if(sub.pts.length<2) continue;
      const sp=sub.pts.map(q=>ap(m,q[0],q[1])); all.push(...sp);
      const d='M'+sp.map(q=>q[0].toFixed(2)+' '+q[1].toFixed(2)).join('L');
      const f=sub.pts[0], l=sub.pts[sub.pts.length-1];
      if(sub.pts.length>2&&Math.hypot(f[0]-l[0],f[1]-l[1])<1e-6){ df+=d+'Z'; ds+=d+'Z'; polys.push(sp); }
      else { ds+=d; open.push(sp); }
    }
    hit+=ds;
    if(df&&p.fill&&fp>0&&!oneD) g.appendChild(svgEl('path',{d:df,fill:fc,'fill-rule':'evenodd',stroke:'none'}));
    if(ds&&p.line&&lp>0) g.appendChild(svgEl('path',{d:ds,fill:'none',stroke:lc,'stroke-width':lw,'stroke-dasharray':dash(lp,lw),'stroke-linejoin':'round','stroke-linecap':'round'}));
  }
  if(oneD&&!all.length){
    const b=ap(parentM,num(sh,'BeginX',0),num(sh,'BeginY',0)), e=ap(parentM,num(sh,'EndX',0),num(sh,'EndY',0));
    if(lp>0) g.appendChild(svgEl('path',{d:`M${b[0]} ${b[1]}L${e[0]} ${e[1]}`,stroke:lc,'stroke-width':lw,fill:'none'}));
    open.push([b,e]); all.push(b,e); hit+=`M${b[0]} ${b[1]}L${e[0]} ${e[1]}`;
  }
  if(oneD&&hit) g.insertBefore(svgEl('path',{d:hit,fill:'none',stroke:'transparent','stroke-width':HIT_TOL_PX*2+2,'vector-effect':'non-scaling-stroke'}),g.firstChild);
  if(oneD) S.lines[id]=open;   // kept for hit testing and hover
  if(lp>0&&open.length){
    const sz=Math.max(8,lw*4.5), me=markerOf(el,sh,'End'), ms=markerOf(el,sh,'Begin');
    if(me!=='none'){ const s=open[open.length-1]; drawMarker(g,s[s.length-2],s[s.length-1],me,sz,lc); }
    if(ms!=='none'){ const s=open[0]; drawMarker(g,s[1],s[0],ms,sz,lc); }
  }
  const pts=oneD?all:all.concat(corners);
  if(pts.length){
    const xs=pts.map(q=>q[0]), ys=pts.map(q=>q[1]);
    S.boxes[id]={x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)};
  }
  if(polys.length&&el.getAttribute('Type')!=='Group') S.polys[id]=polys;

  if(el.getAttribute('Type')==='Group') for(const c of kids(kid(el,'Shapes'),'Shape')) drawShape(c,m,sh.mid,g);

  const txt=num(sh,'HideText',0)?'':shapeText(sh);
  if(txt.trim()){
    const own=n=>{ const v=numEl(el,n,NaN); return isFinite(v)?v:null; };
    const tw=own('TxtWidth')??W, th=own('TxtHeight')??H;
    const cx=(own('TxtPinX')??W/2)-(own('TxtLocPinX')??tw/2)+tw/2, cy=(own('TxtPinY')??H/2)-(own('TxtLocPinY')??th/2)+th/2;
    const c=ap(m,cx,cy), scale=Math.hypot(m[0],m[1]);
    const size=parseFloat(rowV(sh,'Character','0','Size')), fs=Math.max((isFinite(size)?size:0.1389)*PX,4);
    const filled=fp>0&&!oneD&&polys.length>0;
    const col=readableText(colour(rowV(sh,'Character','0','Color'),'#000000'),filled?fc:'#FFFFFF');
    const style=parseInt(rowV(sh,'Character','0','Style'),10)||0;   // bit flags: 1 bold, 2 italic, 4 underline
    let wpx=Math.abs(tw)*scale-8; if(oneD||wpx<40) wpx=Math.max(wpx,160);
    const ha=oneD?1:parseInt(rowV(sh,'Paragraph','0','HorzAlign'),10);   // 0 left, 1 centre, 2 right
    const anchor=ha===0?'start':ha===2?'end':'middle', half=Math.max(Math.abs(tw)*scale/2-4,0);
    const tx=anchor==='start'?c[0]-half:anchor==='end'?c[0]+half:c[0];
    drawLabel(g,wrap(txt,wpx,fs,!!(style&1)),tx,c[1],{fs,anchor,col,style,halo:oneD});
  }
}
/* Wrapped lines of text. valign 'middle' centres the block on y; 'top' hangs it just below y. */
function drawLabel(g,lines,tx,y,{fs,anchor='middle',col,style=0,halo=false,valign='middle'}){
  const lh=fs*1.2, first=valign==='top'?fs:-(lines.length-1)*lh/2+fs*0.35;
  const t=svgEl('text',{x:tx,y,'font-size':fs,'text-anchor':anchor,fill:col,'font-family':FONT,
    'font-weight':style&1?'bold':null,'font-style':style&2?'italic':null,'text-decoration':style&4?'underline':null});
  if(halo) t.setAttribute('style','paint-order:stroke;stroke:#FFFFFF;stroke-width:4px;stroke-linejoin:round');
  lines.forEach((ln,i)=>{ const ts=svgEl('tspan',{x:tx,dy:i===0?first:lh}); ts.textContent=ln; t.appendChild(ts); });
  g.appendChild(t);
}
/* A shape shown as a picture kept from an import (a Visio icon), with its label underneath as Visio draws it */
function drawIconShape(sh,g,id,corners,href){
  const xs=corners.map(q=>q[0]), ys=corners.map(q=>q[1]), b={x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)};
  g.appendChild(svgEl('path',{d:'M'+corners.map(q=>q.join(' ')).join('L')+'Z',fill:'transparent',stroke:'transparent',
    'stroke-width':HIT_PAD_PX*2,'vector-effect':'non-scaling-stroke'}));
  g.appendChild(svgEl('image',{href,x:b.x0,y:b.y0,width:b.x1-b.x0,height:b.y1-b.y0,preserveAspectRatio:'xMidYMid meet'}));
  S.boxes[id]=b;
  const txt=num(sh,'HideText',0)?'':shapeText(sh); if(!txt.trim()) return;
  const size=parseFloat(rowV(sh,'Character','0','Size')), fs=Math.max((isFinite(size)?size:0.1389)*PX,4);
  const col=readableText(colour(rowV(sh,'Character','0','Color'),DEF.text),'#FFFFFF');
  drawLabel(g,wrap(txt,Math.max(b.x1-b.x0+40,120),fs),(b.x0+b.x1)/2,b.y1+2,{fs,col,valign:'top'});
}
const iconFor=el=>{ const n=userV(el,'FlowIcon'); return n&&S.ast&&S.ast.icons?S.ast.icons.get(n)||null:null; };
export function render(){
  const pg=pageCtx(); if(!pg) return;
  const pw=pg.w*PX, ph=pg.h*PX;
  // pageBg covers the whole canvas (grey); paper sits over the top-left part of it at the page's own size, so
  // anything past the page (when an explicit size is smaller than the content) shows through as grey, without
  // the content ever being moved, resized or left out
  for(const r of [$('pageBg'),$('gridRect')]){ r.setAttribute('width',pw); r.setAttribute('height',ph); }
  $('paper').setAttribute('width',pg.pageW*PX); $('paper').setAttribute('height',pg.pageH*PX);
  const layer=$('layer'); layer.replaceChildren();
  S.boxes={}; S.polys={}; S.elById={}; S.lines={};
  for(const s of pg.doc.getElementsByTagNameNS(NS,'Shape')) S.elById[s.getAttribute('ID')]=s;
  const base=[PX,0,0,-PX,0,ph];
  const top=kids(kid(pg.doc.documentElement,'Shapes'),'Shape'), line=el=>is1D(shapeCtx(el,null));
  for(const el of [...top.filter(line),...top.filter(el=>!line(el))]){   // lines go beneath shapes, so a line never shows across a box
    const g=svgEl('g',{'data-id':el.getAttribute('ID')}); layer.appendChild(g);
    try{ drawShape(el,base,null,g); }catch(err){ console.warn('Could not draw shape',el.getAttribute('ID'),err); }
  }
  syncSelection(); if(S.hover&&!S.elById[S.hover]) S.hover=null; drawHover();
  drawOverlay(); updateProps(); updateTitle();
}
export function canResize(el){ const sh=shapeCtx(el,null); return !is1D(sh)&&el.getAttribute('Type')!=='Group'&&Math.abs(num(sh,'Angle',0))<1e-6; }
export function drawOverlay(){
  const ov=$('overlay'); ov.replaceChildren();
  // a selected line is highlighted along its route; a selected shape gets a solid outline just outside it
  const pad=4/S.zoom, all=[];
  for(const id of S.selection){ const b=S.boxes[id]; if(!b) continue; all.push(b);
    const lines=is1D(shapeCtx(S.elById[id],null))&&S.lines[id];
    if(lines&&lines.length) for(const s of lines)
      ov.appendChild(svgEl('path',{d:'M'+s.map(q=>q[0].toFixed(2)+' '+q[1].toFixed(2)).join('L'),class:id===S.sel?'selline':'selline extra'}));
    else ov.appendChild(svgEl('rect',{x:b.x0-pad,y:b.y0-pad,width:Math.max(b.x1-b.x0,0.5)+2*pad,height:Math.max(b.y1-b.y0,0.5)+2*pad,
      rx:3/S.zoom,class:id===S.sel?'selbox':'selbox extra'})); }
  if(all.length>1){   // the whole selection, and how many items are in it
    const x0=Math.min(...all.map(b=>b.x0))-3*pad, y0=Math.min(...all.map(b=>b.y0))-3*pad, x1=Math.max(...all.map(b=>b.x1))+3*pad, y1=Math.max(...all.map(b=>b.y1))+3*pad;
    ov.appendChild(svgEl('rect',{x:x0,y:y0,width:x1-x0,height:y1-y0,class:'groupbox'}));
    const fs=11/S.zoom, label=`${all.length} selected`, w=(label.length*0.62*11+12)/S.zoom, h=18/S.zoom, by=y0-h-2/S.zoom;
    ov.appendChild(svgEl('rect',{x:x0,y:by,width:w,height:h,rx:h/2,class:'selcount'}));
    const t=svgEl('text',{x:x0+w/2,y:by+h/2+fs*0.36,'font-size':fs,'text-anchor':'middle',class:'selcount-text'}); t.textContent=label; ov.appendChild(t);
  }
  if(S.selection.size!==1||!S.boxes[S.sel]) return;   // handles only make sense for one object
  const b=S.boxes[S.sel], el=S.elById[S.sel], sh=shapeCtx(el,null), hs=10/S.zoom, pg=pageCtx();
  if(is1D(sh)){
    if(userV(el,'FlowRoute')==='elbow'){   // a handle in the middle of each segment drags it sideways
      const pts=routePoints(S.sel);
      for(let i=0;i<pts.length-1;i++){ const a=pts[i], c=pts[i+1]; if(Math.hypot(c[0]-a[0],c[1]-a[1])*S.zoom<16) continue;
        const across=Math.abs(a[1]-c[1])<0.5;
        ov.appendChild(svgEl('rect',{x:(a[0]+c[0])/2-hs*0.45,y:(a[1]+c[1])/2-hs*0.45,width:hs*0.9,height:hs*0.9,rx:hs*0.15,
          class:'handle seg '+(across?'ns':'ew'),'data-handle':'seg-'+i})); }
    }
    for(const [h,X,Y] of [['begin',num(sh,'BeginX',0),num(sh,'BeginY',0)],['end',num(sh,'EndX',0),num(sh,'EndY',0)]])
      ov.appendChild(svgEl('circle',{cx:X*PX,cy:(pg.h-Y)*PX,r:hs*0.65,class:'handle','data-handle':h}));
  } else if(canResize(el)){
    for(const [h,x,y] of [['nw',b.x0,b.y0],['ne',b.x1,b.y0],['sw',b.x0,b.y1],['se',b.x1,b.y1]])
      ov.appendChild(svgEl('rect',{x:x-hs/2,y:y-hs/2,width:hs,height:hs,class:'handle','data-handle':h}));
  }
}
export function applyView(){
  $('view').setAttribute('transform',`translate(${S.panX} ${S.panY}) scale(${S.zoom})`);
  $('zoomLbl').textContent=Math.round(S.zoom*100)+'%';
  drawOverlay();
}
export function fit(){
  const pg=pageCtx(); if(!pg) return; const r=stage.getBoundingClientRect();
  const pw=pg.w*PX, ph=pg.h*PX, z=Math.max(0.05,Math.min((r.width-48)/pw,(r.height-48)/ph,4));
  S.zoom=z; S.panX=(r.width-pw*z)/2; S.panY=(r.height-ph*z)/2; applyView();
}
export function zoomAt(f,cx,cy){
  if(S.editing) commitText();
  const nz=Math.min(8,Math.max(0.05,S.zoom*f));
  S.panX=cx-(cx-S.panX)*nz/S.zoom; S.panY=cy-(cy-S.panY)*nz/S.zoom; S.zoom=nz; applyView();
}
export function renderTabs(){
  const t=$('tabs'); t.replaceChildren();
  S.pages.forEach((p,i)=>{
    const b=document.createElement('button'); b.textContent=p.name+(p.bg?' (background)':'');
    b.setAttribute('aria-selected',String(i===S.pi));
    b.onclick=()=>{ if(S.editing) commitText(); S.pi=i; S.sel=null; renderTabs(); render(); fit(); refreshEditor(); };
    t.appendChild(b);
  });
  const add=document.createElement('button'); add.textContent='+'; add.title='Add a page'; add.setAttribute('aria-label','Add a page'); add.onclick=addPage; t.appendChild(add);
}
export function updateTitle(){ $('fileName').textContent=S.name+(S.dirty?' (unsaved changes)':''); document.title=(S.dirty?'* ':'')+S.name+' | Flow editor'; }
