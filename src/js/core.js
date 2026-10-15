
export const NS='http://schemas.microsoft.com/office/visio/2012/main';
export const RNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const PRNS='http://schemas.openxmlformats.org/package/2006/relationships';
const SVGNS='http://www.w3.org/2000/svg';
export const PX=96;                 // screen px per inch at 100%
export const MM=1/25.4;             // inches per mm
export const XML_DECL='<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n';
export const DEF={fill:'#FFFFFF',line:'#2B3A47',text:'#1E2933'};
export const WALK='_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)';

export const S={zip:null,name:'Untitled.flow',text:'',ast:null,built:[],handle:null,pages:[],pi:0,masters:{},styles:{},
  zoom:1,panX:40,panY:40,sel:null,tool:'select',undo:[],redo:[],dirty:false,
  boxes:{},polys:{},elById:{},editing:null};
export const $=id=>document.getElementById(id);
export const svg=$('canvas'), stage=$('stage');

/* ---------- small helpers ---------- */
export const kids=(el,n)=>el?[...el.children].filter(c=>c.localName===n):[];
export const kid=(el,n)=>el?[...el.children].find(c=>c.localName===n)||null:null;
export function ownCell(el,n){ if(!el) return null; for(const c of el.children) if(c.localName==='Cell'&&c.getAttribute('N')===n) return c; return null; }
export function fmtV(v){ if(typeof v!=='number') return String(v); if(!isFinite(v)||Math.abs(v)<1e-9) return '0'; return String(Math.round(v*1e10)/1e10); }
function mkNS(doc,ns,name,attrs={},children=[]){ const e=doc.createElementNS(ns,name); for(const k in attrs) if(attrs[k]!=null) e.setAttribute(k,attrs[k]); for(const c of children) e.appendChild(c); return e; }
export const mk=(doc,name,attrs,children)=>mkNS(doc,NS,name,attrs,children);
export function cellEl(doc,n,v,f,u){ return mk(doc,'Cell',{N:n,V:fmtV(v),F:f||null,U:u||null}); }
export function svgEl(n,a={}){ const e=document.createElementNS(SVGNS,n); for(const k in a) if(a[k]!=null) e.setAttribute(k,a[k]); return e; }
export const ser=d=>new XMLSerializer().serializeToString(d.documentElement);
export function parseXml(t){ const d=new DOMParser().parseFromString(t,'application/xml'); if(d.getElementsByTagName('parsererror').length) throw new Error('XML parse error'); return d; }
/* Shortest distance from (x,y) to a set of polylines, each a list of [x,y] points */
export function distToPolyline(segs,x,y){
  let best=Infinity;
  for(const s of segs||[]) for(let i=1;i<s.length;i++){
    const [ax,ay]=s[i-1], [bx,by]=s[i], dx=bx-ax, dy=by-ay, L=dx*dx+dy*dy, t=L?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/L)):0;
    best=Math.min(best,Math.hypot(x-ax-t*dx,y-ay-t*dy)); }
  return best;
}
export const snapIn=v=>{ const g=2.5*MM; return Math.round(v/g)*g; };
let toastTimer;
export function toast(msg,ms=4500){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),ms); }

/* Cell writes: f undefined = drop formula, string = set formula, null = keep existing formula */
const CELL_STOP=new Set(['Trigger','Section','Text','Data1','Data2','Data3','ForeignData','Shapes']);
export function setCell(el,n,v,f){
  let c=ownCell(el,n);
  if(!c){ c=el.ownerDocument.createElementNS(NS,'Cell'); c.setAttribute('N',n);
    el.insertBefore(c,[...el.children].find(x=>CELL_STOP.has(x.localName))||null); }
  c.setAttribute('V',fmtV(v)); c.removeAttribute('E');
  if(f===undefined) c.removeAttribute('F'); else if(f!==null) c.setAttribute('F',f);
  return c;
}
export function delCell(el,n){ const c=ownCell(el,n); if(c) c.remove(); }
export function insertSection(el,sec){ el.insertBefore(sec,[...el.children].find(x=>['Text','Data1','Data2','Data3','ForeignData','Shapes'].includes(x.localName))||null); }

/* Evaluate simple ShapeSheet formulas such as Width*0.5 or Width-Height*0.5 */
export function evalF(f,W,H){
  if(!f) return null;
  const s=f.replace(/GUARD\(/g,'(').replace(/\bWidth\b/g,'('+W+')').replace(/\bHeight\b/g,'('+H+')');
  if(!/^[0-9.+\-*/()\seE]+$/.test(s)) return null;
  try{ const v=Function('"use strict";return ('+s+')')(); return isFinite(v)?v:null; }catch(_){ return null; }
}

/* ---------- colour ---------- */
const PALETTE=['#000000','#FFFFFF','#FF0000','#00FF00','#0000FF','#FFFF00','#FF00FF','#00FFFF','#800000','#008000','#000080','#808000','#800080','#008080','#C0C0C0','#E6E6E6','#CDCDCD','#B3B3B3','#9A9A9A','#808080','#666666','#4D4D4D','#333333','#1A1A1A'];
/* WCAG relative luminance and contrast ratio, used to keep text readable when a fill cannot be resolved */
function luminance(hex){
  const ch=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);
  return 0.2126*ch[0]+0.7152*ch[1]+0.0722*ch[2];
}
function contrast(a,b){ const la=luminance(a), lb=luminance(b); return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05); }
const MIN_TEXT_CONTRAST=1.5;
export function readableText(col,bg){
  if(contrast(col,bg)>=MIN_TEXT_CONTRAST) return col;
  return contrast(DEF.text,bg)>=contrast('#FFFFFF',bg)?DEF.text:'#FFFFFF';
}
export function colour(v,d){
  if(v==null) return d; v=String(v).trim();
  if(/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if(/^\d+$/.test(v)&&+v<PALETTE.length) return PALETTE[+v];
  const m=v.match(/^RGB\((\d+),\s*(\d+),\s*(\d+)\)$/i);
  if(m) return '#'+[m[1],m[2],m[3]].map(x=>(+x).toString(16).padStart(2,'0')).join('').toUpperCase();
  return d;
}
