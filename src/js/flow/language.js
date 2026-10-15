/* ---------- the language ---------- */
import {SHAPES, tableHeight} from '../shapes.js';
import {clampN} from '../formats/export.js';
import {sizeFor} from '../layout.js';
import {CARD_L, CARD_L_TOK, CARD_R, CARD_R_TOK, CONN, LINE_STYLES, MARKERS, parseVia, resolveType, viaToStr} from './model.js';

export const KIND_ALIASES={rect:'process',box:'process',step:'process',diamond:'decision',start:'terminator',end:'terminator',stadium:'terminator',
  db:'database',cylinder:'database',doc:'document',docs:'multidoc',person:'user',actor:'user',component:'api',system:'api',hexagon:'preparation',
  circle:'ellipse',label:'text',note:'text',screen:'mobile',input:'field',select:'dropdown'};
export let FLOW_KINDS;
export const FLOW_ID=/^[A-Za-z_][\w-]*$/;
const SHAPE_ATTRS=['fill','stroke','text','weight','icon'], EDGE_ATTRS=['style','start','end','stroke','weight','means','route','via'];
/* A picture kept from an import, such as a Visio icon: icon web_design "data:image/svg+xml;base64,..."
   Only SVG and PNG data URIs are accepted; they are drawn with <image>, which runs no scripts and loads nothing. */
export const ICON_DATA=/^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+=*$/;
const MAX_ICON_CHARS=2e6;
export const iconStmt=(name,data)=>`icon ${name} ${qs(data)}`;
const qs=s=>'"'+String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r?\n|[\u2028\u2029]/g,'\\n')+'"';
const unescapeStr=s=>s.replace(/\\(.)/g,(_,c)=>c==='n'?'\n':c);
const mmN=v=>String(Math.round(v*10)/10);
function readString(s,p){ let i=p+1, v=''; while(i<s.length&&s[i]!=='"'){ if(s[i]==='\\'&&i+1<s.length){ v+=s[i]+s[i+1]; i+=2; } else v+=s[i++]; } return i<s.length?{v:unescapeStr(v),end:i+1}:null; }
function closeAt(s,p,ch){ let q=false; for(let i=p+1;i<s.length;i++){ if(q&&s[i]==='\\'){ i++; continue; } if(s[i]==='"') q=!q; else if(!q&&s[i]===ch) return i; } return -1; }
export function splitComment(line){   // # starts a comment at the start of a line or after a space, so colours like fill=#1F6F78 are safe
  let q=false;
  for(let i=0;i<line.length;i++){ const c=line[i];
    if(q&&c==='\\'){ i++; continue; } if(c==='"') q=!q;
    else if(c==='#'&&!q&&(i===0||/\s/.test(line[i-1]))) return {code:line.slice(0,i),comment:line.slice(i)}; }
  return {code:line,comment:''};
}
function splitList(s){ const out=[]; let cur='', q=false;
  for(let i=0;i<s.length;i++){ const c=s[i]; if(q&&c==='\\'){ cur+=c+(s[i+1]||''); i++; continue; } if(c==='"') q=!q;
    if(!q&&(c===';'||c===',')){ out.push(cur); cur=''; } else cur+=c; }
  out.push(cur);
  return out.map(x=>x.trim()).filter(Boolean).map(x=>/^".*"$/.test(x)?unescapeStr(x.slice(1,-1)):x);
}
function parseAttrs(s,allowed,fail){
  const a={}, re=/([A-Za-z][\w-]*)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s,]+)/g; let m, rest=s;
  while((m=re.exec(s))){ const k=m[1].toLowerCase(); let v=m[2]; if(v.startsWith('"')) v=unescapeStr(v.slice(1,-1));
    if(!allowed.includes(k)) return fail(`Unknown setting "${m[1]}". Use ${allowed.join(', ')}.`);
    if((k==='fill'||k==='stroke'||k==='text')&&!/^#[0-9a-f]{6}$/i.test(v)) return fail(`${k} needs a colour like #1F6F78.`);
    if(k==='weight'){ const w=+v; if(!(w>=0.25&&w<=12)) return fail('weight is a line thickness in points, from 0.25 to 12.'); v=w; }
    if(k==='style'&&!LINE_STYLES[v]) return fail('style is solid, dashed or dotted.');
    if((k==='start'||k==='end')&&!MARKERS[v]) return fail(`${k} is one of: ${Object.keys(MARKERS).join(', ')}.`);
    if(k==='route'&&v!=='straight'&&v!=='elbow') return fail('route is straight or elbow.');
    if(k==='icon'&&!/^[A-Za-z_][\w-]*$/.test(v)) return fail('icon is the name of an icon line, like icon=web_design.');
    if(k==='via'){ v=parseVia(v); if(!v) return fail('via lists bend points in mm from the top-left of the page, like via="40,20 40,60".'); }
    a[k]=typeof v==='string'&&/^#/.test(v)?v.toUpperCase():v; rest=rest.replace(m[0],''); }
  if(rest.replace(/[\s,]/g,'')) return fail(`Could not read the settings "${rest.trim()}".`);
  return a;
}
function parseConnector(tok){
  for(const [type,c] of Object.entries(CONN)) if(c.token===tok) return {style:c.style,start:c.start,end:c.end};
  const m=tok.match(/^([|}][|o])(--|\.\.)([|o][|{])$/);
  if(m) return {style:m[2]==='--'?'solid':'dashed',start:CARD_L[m[1]],end:CARD_R[m[3]]};
  return null;
}
export function parseFlow(text){
  const lines=text.split('\n'), ast={pages:[],errors:[],icons:new Map()}; let page=null;
  const newPage=(name,line)=>{ page={name,size:null,direction:'TB',headerLine:line,shapes:[],byId:new Map(),edges:[],edgeByLine:new Map(),key:null,
    lastShapeLine:null,lastEdgeLine:null,endLine:line??0}; ast.pages.push(page); return page; };
  lines.forEach((raw,i)=>{
    const code=splitComment(raw).code.trim(); if(page) page.endLine=i;
    if(!code) return;
    const fail=msg=>{ ast.errors.push({line:i,msg}); return null; };
    let m;
    if((m=code.match(/^flow\s+(\S+)$/i))){ if(ast.pages.length) fail('"flow" belongs at the top of the file.'); else if(m[1]!=='1') fail(`This editor reads version 1 flow files, not version ${m[1]}.`); return; }
    if((m=code.match(/^icon\s+([A-Za-z_][\w-]*)\s+(.*)$/i))){
      const s=m[2].startsWith('"')&&readString(m[2],0);
      if(!s||m[2].slice(s.end).trim()) return fail('An icon needs a name and a picture in quotes, like icon server "data:image/svg+xml;base64,...".');
      if(s.v.length>MAX_ICON_CHARS||!ICON_DATA.test(s.v)) return fail('An icon picture must be an SVG or PNG data URI.');
      if(ast.icons.has(m[1])) return fail(`The icon "${m[1]}" is defined twice.`);
      ast.icons.set(m[1],s.v); return;
    }
    if((m=code.match(/^page\b\s*(.*)$/i))){
      const rest=m[1], s=rest.startsWith('"')&&readString(rest,0); if(!s) return fail('A page needs a name in quotes, like page "Onboarding".');
      const p=newPage(s.v,i); let r=rest.slice(s.end), mm;
      while((r=r.trim())){
        if((mm=r.match(/^size\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i))){ p.size=[clampN(+mm[1],50,5000,297),clampN(+mm[2],50,5000,210)]; r=r.slice(mm[0].length); }
        else if((mm=r.match(/^direction\s+(TB|TD|LR|BT|RL)\b/i))){ const d=mm[1].toUpperCase(); p.direction=d==='TD'?'TB':d; r=r.slice(mm[0].length); }
        else return fail(`Unexpected "${r.slice(0,20)}" in the page line. Use size WxH (mm) and direction TB, LR, BT or RL.`);
      }
      return;
    }
    if(!page) newPage('Page-1',null);
    if((m=code.match(/^key\b(?!\s*:)\s*(.*)$/i))){
      if(page.key) return fail('A page has one key.');
      const k={title:'Key',place:null,line:i}; let r=m[1].trim(), mm;
      if(r.startsWith('"')){ const s=readString(r,0); if(!s) return fail('The key title is not closed.'); k.title=s.v; r=r.slice(s.end).trim(); }
      if(r){ if(!(mm=r.match(/^@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/))) return fail('A key line looks like key "Key" @ x,y.'); k.place={x:+mm[1],y:+mm[2]}; }
      page.key=k; page.lastShapeLine=i; return;
    }
    if((m=code.match(/^([A-Za-z_][\w-]*)\s*:\s*([A-Za-z]+)\b(.*)$/))){
      const id=m[1], kindIn=m[2].toLowerCase(), kind=FLOW_KINDS.find(k=>k.toLowerCase()===kindIn)||KIND_ALIASES[kindIn];
      if(!kind) return fail(`Unknown shape type "${m[2]}". Try: ${FLOW_KINDS.slice(0,8).join(', ')}…`);
      if(page.byId.has(id)) return fail(`"${id}" is already used on this page.`);
      const o={label:'',columns:null,place:null,attrs:{}}, rest=m[3]; let p=0;
      while(p<rest.length){ const c=rest[p];
        if(/\s/.test(c)){ p++; continue; }
        if(c==='"'){ const s=readString(rest,p); if(!s) return fail('A quoted label is not closed.'); o.label=s.v; p=s.end; continue; }
        if(c==='{'){ const e=closeAt(rest,p,'}'); if(e<0) return fail('A column list is missing its closing }.'); o.columns=splitList(rest.slice(p+1,e)); p=e+1; continue; }
        if(c==='@'){ const mm=rest.slice(p).match(/^@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?))?/);
          if(!mm) return fail('A placement looks like @ x,y or @ x,y WxH, in millimetres.');
          o.place={x:clampN(+mm[1],-1e4,1e4,0),y:clampN(+mm[2],-1e4,1e4,0),w:mm[3]!=null?clampN(+mm[3],2,2000,40):null,h:mm[4]!=null?clampN(+mm[4],2,2000,20):null}; p+=mm[0].length; continue; }
        if(c==='['){ const e=closeAt(rest,p,']'); if(e<0) return fail('A settings list is missing its closing ].'); const a=parseAttrs(rest.slice(p+1,e),SHAPE_ATTRS,fail); if(!a) return; Object.assign(o.attrs,a); p=e+1; continue; }
        return fail(`Unexpected "${rest.slice(p,p+15).trim()}" in the shape line.`);
      }
      if(kind==='table'&&!o.columns) o.columns=['column'];
      if(kind!=='table'&&o.columns) return fail('Only tables have a { column; list }.');
      const d={id,kind,label:o.label,columns:o.columns,place:o.place,attrs:o.attrs,line:i};
      page.shapes.push(d); page.byId.set(id,d); page.lastShapeLine=i; return;
    }
    if((m=code.match(/^([A-Za-z_][\w-]*)\s+(\S+)\s+([A-Za-z_][\w-]*)(.*)$/))){
      const base=parseConnector(m[2]);
      if(!base) return fail(`"${m[2]}" is not a connection. Try -> for a sequence, -data-> for data flow, ..> for a dependency or ||--o{ for one to many.`);
      if(m[1]===m[3]) return fail('A connection needs two different shapes.');
      const e={from:m[1],to:m[3],...base,means:'',stroke:null,weight:null,label:'',line:i}; let r=m[4].trim();
      if(r.startsWith('[')){ const end=closeAt(r,0,']'); if(end<0) return fail('A settings list is missing its closing ].');
        const a=parseAttrs(r.slice(1,end),EDGE_ATTRS,fail); if(!a) return; Object.assign(e,a); r=r.slice(end+1).trim(); }
      if(r.startsWith(':')){ r=r.slice(1).trim(); if(r.startsWith('"')){ const s=readString(r,0); if(!s) return fail('The label is not closed.'); e.label=s.v; r=r.slice(s.end).trim(); } else { e.label=r; r=''; } }
      if(r) return fail(`Unexpected "${r.slice(0,15)}" after the connection.`);
      page.edges.push(e); page.edgeByLine.set(i,e); page.lastEdgeLine=i; return;
    }
    fail('This line is not a page, shape, connection or key.');
  });
  if(!ast.pages.length){ newPage('Page-1',null); page.endLine=lines.length-1; }
  for(const p of ast.pages) for(const e of p.edges) for(const id of [e.from,e.to]) if(!p.byId.has(id)){
    const d={id,kind:'process',label:id,columns:null,place:null,attrs:{},line:null,implicit:true}; p.shapes.push(d); p.byId.set(id,d); }
  return ast;
}
/* canonical statements: what the editor writes, and how two statements are compared */
const orderedAttrs=(a,keys)=>Object.fromEntries(keys.filter(k=>a&&a[k]!=null&&a[k]!=='').map(k=>[k,a[k]]));
const attrStr=a=>{ const p=Object.entries(a).map(([k,v])=>`${k}=${/^[#\w.]+$/.test(String(v))?v:qs(v)}`); return p.length?'['+p.join(' ')+']':''; };
const colText=c=>/^[^;,{}"\s#](?:[^;,{}"#]*[^;,{}"\s#])?$/.test(c)?c:qs(c);
export function shapeStmt(o){
  let s=`${o.id}: ${o.kind}`;
  if(o.label) s+=' '+qs(o.label);
  if(o.kind==='table') s+=' { '+(o.columns||[]).map(colText).join('; ')+' }';
  if(o.place) s+=` @ ${mmN(o.place.x)},${mmN(o.place.y)}`+(o.place.w!=null?` ${mmN(o.place.w)}x${mmN(o.place.h)}`:'');
  const a=attrStr(orderedAttrs(o.attrs,SHAPE_ATTRS)); return a?s+' '+a:s;
}
export function edgeStmt(e){
  const t=resolveType(e), a={}; let tok;
  if(t==='er') tok=CARD_L_TOK[e.start]+(e.style==='solid'?'--':'..')+CARD_R_TOK[e.end];
  else if(t==='custom'){ tok='--'; Object.assign(a,{style:e.style,start:e.start,end:e.end}); }
  else tok=CONN[t].token;
  const elbow=e.route==='elbow';
  Object.assign(a,orderedAttrs({stroke:e.stroke,weight:e.weight,means:e.means,route:elbow?'elbow':null,via:elbow&&e.via&&e.via.length?viaToStr(e.via):null},
    ['stroke','weight','means','route','via']));
  let s=`${e.from} ${tok} ${e.to}`; const as=attrStr(a); if(as) s+=' '+as; if(e.label) s+=' : '+qs(e.label); return s;
}
export const keyStmt=k=>`key ${qs(k.title||'Key')}`+(k.place?` @ ${mmN(k.place.x)},${mmN(k.place.y)}`:'');
export const pageStmt=p=>`page ${qs(p.name)}`+(p.size?` size ${mmN(p.size[0])}x${mmN(p.size[1])}`:'')+(p.direction&&p.direction!=='TB'?` direction ${p.direction}`:'');
export const tableH=cols=>tableHeight(Math.max(1,(cols||[]).length))*25.4;
export function declObj(d){
  if(d.implicit) return {id:d.id,kind:'process',label:d.id,place:null,attrs:{}};
  const place=d.place?{...d.place}:null; if(place&&d.kind==='table'&&place.w!=null) place.h=tableH(d.columns);
  return {id:d.id,kind:d.kind,label:d.label||'',columns:d.columns,place,attrs:d.attrs};
}
export function autoSizeMM(o){ const s=sizeFor({kind:o.kind,label:o.label||'',columns:o.columns}); return {w:s.w*25.4,h:o.kind==='table'?tableH(o.columns):s.h*25.4}; }
export function uniqueFid(base,used){
  let b=String(base||'shape').toLowerCase().normalize('NFKD').replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,24)||'shape';
  if(!/^[a-z_]/.test(b)) b='s_'+b; if(['key','page','flow'].includes(b)) b+='_1';
  let id=b, n=2; while(used.has(id)) id=`${b}_${n++}`; return id;
}

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  FLOW_KINDS=Object.keys(SHAPES).filter(k=>!/^table(Header|Row)$/.test(k));
}
