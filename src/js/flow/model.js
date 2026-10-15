/* =====================================================================
   Flow documents (.flow): the editor's own text format and the single source of truth.
   The canvas is always rebuilt from the text. A canvas edit changes the model, the model is written
   back into the text (only the statements that changed are rewritten, so comments and layout survive),
   and the canvas is rebuilt from the new text. Undo and redo work on the text.

     flow 1
     page "Onboarding" size 297x210 direction TB
     lumis: process "Lumis account created" @ 120,40     # placement in mm from the top left, optional
     users: table "users" { id; name; email }
     lumis -> internal : "next"
     users ||--o{ orders
     key "Key" @ 230,15
   ===================================================================== */

/* ---------- connection types ---------- */
import {DEF, cellEl, colour, insertSection, kids, mk, ownCell, setCell, svgEl} from '../core.js';
import {cellV, num, shapeCtx} from '../visio-package.js';

export const MARKERS={none:'None',arrow:'Filled arrow',open:'Open arrow',triangle:'Hollow triangle',diamond:'Hollow diamond',fdiamond:'Filled diamond',
  circle:'Circle',one:'Exactly one',zeroOne:'Zero or one',oneMany:'One or many',zeroMany:'Zero or many'};
export const CARDS=['one','zeroOne','oneMany','zeroMany'];
const CARD_TEXT={one:'exactly one',zeroOne:'zero or one',oneMany:'one or many',zeroMany:'zero or many'};
export const LINE_STYLES={solid:1,dashed:2,dotted:3};
export const CONN={
  flow:{set:'Process flow',name:'Sequence',means:'This step happens next.',token:'->',style:'solid',start:'none',end:'arrow'},
  data:{set:'Process flow',name:'Data flow',means:'Information passes from one to the other.',token:'-data->',style:'dashed',start:'none',end:'arrow'},
  msg:{set:'Process flow',name:'Message',means:'One notifies the other, often across teams or systems.',token:'-msg->',style:'dashed',start:'circle',end:'triangle'},
  alt:{set:'Process flow',name:'Alternative path',means:'Only taken if something goes wrong or a condition is not met.',token:'-alt->',style:'dotted',start:'none',end:'arrow'},
  both:{set:'Process flow',name:'Two-way',means:'Exchange or sync in both directions.',token:'<->',style:'solid',start:'arrow',end:'arrow'},
  assoc:{set:'Process flow',name:'Annotation',means:'Related to, or see note. No flow is implied.',token:'..',style:'dotted',start:'none',end:'none'},
  dependency:{set:'System relationships',name:'Dependency',means:'Uses or depends on.',token:'..>',style:'dashed',start:'none',end:'open'},
  association:{set:'System relationships',name:'Association',means:'Connected to.',token:'--',style:'solid',start:'none',end:'none'},
  generalisation:{set:'System relationships',name:'Generalisation',means:'Is a type of.',token:'--|>',style:'solid',start:'none',end:'triangle'},
  realisation:{set:'System relationships',name:'Realisation',means:'Implements.',token:'..|>',style:'dashed',start:'none',end:'triangle'},
  aggregation:{set:'System relationships',name:'Aggregation',means:'Has; the part can exist on its own.',token:'o--',style:'solid',start:'diamond',end:'none'},
  composition:{set:'System relationships',name:'Composition',means:'Owns; the part cannot exist without it.',token:'*--',style:'solid',start:'fdiamond',end:'none'},
  er:{set:'Database',name:'Relationship (crow\u2019s foot)',means:'The symbol at each end shows how many of that item there can be.',style:'solid',start:'one',end:'zeroMany'},
  custom:{set:'Custom',name:'Custom line',means:'A line with your own meaning.',style:'solid',start:'none',end:'arrow'}
};
export const CONN_SETS=['Process flow','System relationships','Database','Custom'];
export const CARD_L={'||':'one','|o':'zeroOne','}|':'oneMany','}o':'zeroMany'}, CARD_R={'||':'one','o|':'zeroOne','|{':'oneMany','o{':'zeroMany'};
const invert=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[v,k]));
export const CARD_L_TOK=invert(CARD_L), CARD_R_TOK=invert(CARD_R);
export const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
export function resolveType(e){
  for(const [t,c] of Object.entries(CONN)) if(c.token&&c.style===e.style&&c.start===e.start&&c.end===e.end) return t;
  if(CARDS.includes(e.start)&&CARDS.includes(e.end)&&(e.style==='solid'||e.style==='dashed')) return 'er';
  return 'custom';
}
export function connName(e){ const t=resolveType(e); return t==='er'?`${cap(CARD_TEXT[e.start])} to ${CARD_TEXT[e.end]}`:CONN[t].name; }
export function connMeans(e,from,to){
  if(e.means) return e.means;
  const t=resolveType(e);
  if(t==='er'&&from&&to) return `Each ${from} has ${CARD_TEXT[e.end]} ${to}; each ${to} belongs to ${CARD_TEXT[e.start]} ${from}.`;
  return CONN[t].means;
}
/* a short tag added to labels in formats that cannot draw the line, so the meaning is not lost */
export const connTag=e=>{ const t=resolveType(e); return t==='er'?`${CARD_TEXT[e.start]} to ${CARD_TEXT[e.end]}`:t==='custom'?(e.means||'custom line'):CONN[t].name.toLowerCase(); };
let TAG_TYPES;
export function applyTags(g){   // reverse of connTag: "Automation (data flow)" becomes a data-flow connection labelled "Automation"
  const cardRe=new RegExp(`^(${Object.values(CARD_TEXT).join('|')}) to (${Object.values(CARD_TEXT).join('|')})$`,'i'), byText=invert(CARD_TEXT);
  for(const e of g.edges){
    const m=(e.label||'').match(/^(.*?)\s*[(\[]([^()[\]]+)[)\]]\s*$/); if(!m) continue;   // activity diagrams carry the tag in [brackets]
    const tag=m[2].trim().toLowerCase(), cm=tag.match(cardRe);
    if(TAG_TYPES[tag]){ const c=CONN[TAG_TYPES[tag]]; Object.assign(e,{style:c.style,start:c.start,end:c.end}); e.label=m[1]; }
    else if(cm){ Object.assign(e,{style:e.style==='dashed'?'dashed':'solid',start:byText[cm[1].toLowerCase()],end:byText[cm[2].toLowerCase()]}); e.label=m[1]; }
  }
  return g;
}

/* ---------- user-defined cells: how the model remembers flow ids and connection styles ---------- */
function userRow(el,name,create){
  let sec=kids(el,'Section').find(s=>s.getAttribute('N')==='User');
  if(!sec){ if(!create) return null; sec=mk(el.ownerDocument,'Section',{N:'User'}); insertSection(el,sec); }
  let row=kids(sec,'Row').find(r=>r.getAttribute('N')===name);
  if(!row&&create){ row=mk(el.ownerDocument,'Row',{N:name}); sec.appendChild(row); }
  return row;
}
export function userV(el,name){ const r=userRow(el,name,false), c=r&&ownCell(r,'Value'); return c?c.getAttribute('V'):null; }
export function setUser(el,name,v){ const r=userRow(el,name,true); let c=ownCell(r,'Value'); if(!c){ c=cellEl(el.ownerDocument,'Value',0,null,'STR'); r.appendChild(c); } c.setAttribute('V',String(v)); }
export function delUser(el,name){ const r=userRow(el,name,false); if(r) r.remove(); }

/* Visio's arrowhead numbers are not documented. 13 is the filled arrow this editor has always written;
   the others fall back until they are confirmed with visio-arrow-ends-test.vsdx. */
const VISIO_END={none:0,arrow:13};
export const VISIO_CONFIRMED=new Set(Object.keys(VISIO_END));
const visioEnd=m=>m in VISIO_END?VISIO_END[m]:(m==='open'||m==='triangle'?13:0);
/* Bend points of a right-angled connection, in mm from the page's top-left corner. In the text they read
   via="40,20 40,60". parseVia gives [] for none and null for anything it cannot read. */
const MAX_BENDS=50;
export const viaToStr=pts=>pts.map(p=>p.map(v=>Math.round(v*10)/10).join(',')).join(' ');
export function parseVia(s){
  if(s==null||!String(s).trim()) return [];
  const pts=String(s).trim().split(/\s+/).map(p=>p.split(',').map(Number));
  return pts.length<=MAX_BENDS&&pts.every(p=>p.length===2&&p.every(Number.isFinite))?pts:null;
}
export function setEdgeStyle(el,e){
  setCell(el,'LinePattern',LINE_STYLES[e.style]||1);
  setUser(el,'FlowStart',e.start||'none'); setUser(el,'FlowEnd',e.end||'none');
  if(e.means) setUser(el,'FlowMeans',e.means); else delUser(el,'FlowMeans');
  if(e.route==='elbow') setUser(el,'FlowRoute','elbow'); else delUser(el,'FlowRoute');
  if(e.route==='elbow'&&e.via&&e.via.length) setUser(el,'FlowVia',viaToStr(e.via)); else delUser(el,'FlowVia');
  setCell(el,'BeginArrow',visioEnd(e.start)); setCell(el,'EndArrow',visioEnd(e.end));
  setCell(el,'LineColor',e.stroke||DEF.line); setCell(el,'LineWeight',(e.weight||1)/72);
}
export function markerOf(el,sh,end){ const u=userV(el,end==='Begin'?'FlowStart':'FlowEnd'); return u&&MARKERS[u]?u:(num(sh,end+'Arrow',0)>0?'arrow':'none'); }
export const weightOf=sh=>{ const w=Math.round(num(sh,'LineWeight',1/72)*72*4)/4; return Math.abs(w-1)>0.01?w:null; };
export function edgeStyleOf(el){
  const sh=shapeCtx(el,null), lp=num(sh,'LinePattern',1), stroke=colour(cellV(sh,'LineColor',null),null);
  const route=userV(el,'FlowRoute')==='elbow'?'elbow':null, via=route&&parseVia(userV(el,'FlowVia'));
  return {style:lp===3?'dotted':lp>=2?'dashed':'solid',start:markerOf(el,sh,'Begin'),end:markerOf(el,sh,'End'),means:userV(el,'FlowMeans')||'',
    stroke:stroke&&stroke!==DEF.line.toUpperCase()?stroke:null,weight:weightOf(sh),route,via:via&&via.length?via:null};
}
/* draw a line end at tip, for a line arriving from 'from' */
export function drawMarker(g,from,tip,kind,sz,col){
  if(!kind||kind==='none') return;
  const dx=tip[0]-from[0], dy=tip[1]-from[1], L=Math.hypot(dx,dy)||1, u=[dx/L,dy/L], n=[-u[1],u[0]], sw=Math.max(1,sz/8), W='#FFFFFF';
  const P=(a,b)=>[tip[0]-u[0]*a+n[0]*b,tip[1]-u[1]*a+n[1]*b];
  const d=pts=>'M'+pts.map(p=>p[0].toFixed(2)+' '+p[1].toFixed(2)).join('L');
  const path=(dd,fill)=>g.appendChild(svgEl('path',{d:dd,fill:fill||'none',stroke:col,'stroke-width':sw,'stroke-linejoin':'round','stroke-linecap':'round'}));
  const ring=a=>{ const c=P(a,0); g.appendChild(svgEl('circle',{cx:c[0],cy:c[1],r:sz*0.32,fill:W,stroke:col,'stroke-width':sw})); };
  const bar=a=>path(d([P(a,sz*0.55),P(a,-sz*0.55)]));
  const crow=()=>path(d([P(0,sz*0.62),P(sz,0),P(0,-sz*0.62)])+d([P(0,0),P(sz,0)]));
  switch(kind){
    case 'arrow': path(d([tip,P(sz,sz*0.45),P(sz,-sz*0.45)])+'Z',col); break;
    case 'open': path(d([P(sz,sz*0.5),tip,P(sz,-sz*0.5)])); break;
    case 'triangle': path(d([tip,P(sz*1.2,sz*0.6),P(sz*1.2,-sz*0.6)])+'Z',W); break;
    case 'diamond': case 'fdiamond': path(d([tip,P(sz*0.8,sz*0.45),P(sz*1.6,0),P(sz*0.8,-sz*0.45)])+'Z',kind==='diamond'?W:col); break;
    case 'circle': ring(sz*0.36); break;
    case 'one': bar(sz*0.5); bar(sz*0.9); break;
    case 'zeroOne': bar(sz*0.5); ring(sz*1.25); break;
    case 'oneMany': crow(); bar(sz*1.3); break;
    case 'zeroMany': crow(); ring(sz*1.4); break;
  }
}

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  TAG_TYPES=Object.fromEntries(Object.entries(CONN).filter(([t])=>t!=='er'&&t!=='custom').map(([t,c])=>[c.name.toLowerCase(),t]));
}
