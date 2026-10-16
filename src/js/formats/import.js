/* =====================================================================
   Importers
   ===================================================================== */
import {parseXml} from '../core.js';
import {SHAPES} from '../shapes.js';
import {DRAWIO_PPI, MAX_IMPORT_CHARS, MAX_NODES, PU_NATIVE, clampN, dioMarker, plural} from './export.js';
import {typeStyle} from '../connection-props.js';

const newGraph=()=>({nodes:[],edges:[],direction:'TB',positioned:false,warnings:[]});
function graphNode(g,map,id,init){
  let n=map.get(id);
  if(!n){ if(g.nodes.length>=MAX_NODES) throw new Error(`the diagram has more than ${MAX_NODES} shapes`); n={id,kind:'process',label:id,...init}; map.set(id,n); g.nodes.push(n); }
  return n;
}
/* HTML to plain text through an inert parsed document: scripts in it never run and nothing is inserted into the page */
function htmlToText(s){
  const d=new DOMParser().parseFromString('<!doctype html><body>'+String(s).replace(/<br\s*\/?>/gi,'\n').replace(/<\/(div|p|li|tr)>/gi,'\n'),'text/html');
  return d.body.textContent.replace(/\u00A0/g,' ').replace(/\n{2,}/g,'\n').trim();
}
const dedupeEdges=g=>{ const seen=new Set(); g.edges=g.edges.filter(e=>{ const k=e.from+'\u0000'+e.to+'\u0000'+e.label; if(seen.has(k)) return false; seen.add(k); return true; }); };
function splitOutside(line,sep){   // split on sep except inside double quotes
  const out=[]; let cur='', q=false;
  for(const ch of line){ if(ch==='"') q=!q; if(ch===sep&&!q){ out.push(cur); cur=''; } else cur+=ch; }
  out.push(cur); return out;
}

/* ---------- Mermaid flowchart ---------- */
const MM_OPEN=[['(((',')))','ellipse'],['([','])','terminator'],['((','))','ellipse'],['[[',']]','subprocess'],['[(',')]','database'],
  ['{{','}}','preparation'],['[/','/]','data'],['[/','\\]','manualOp'],['[\\','\\]','data'],['[\\','/]','manualOp'],['>',']','process'],
  ['(',')','process'],['[',']','process'],['{','}','decision']];
const MM_SHAPES={rect:'process',proc:'process',process:'process',rectangle:'process',rounded:'process',event:'process',
  diam:'decision',decision:'decision',diamond:'decision',question:'decision',stadium:'terminator',pill:'terminator',terminal:'terminator',
  'lean-r':'data','lean-l':'data','in-out':'data','out-in':'data','fr-rect':'subprocess',subproc:'subprocess',subprocess:'subprocess',subroutine:'subprocess','framed-rectangle':'subprocess',
  cyl:'database',cylinder:'database',database:'database',db:'database',circle:'ellipse',circ:'ellipse','dbl-circ':'ellipse','sm-circ':'ellipse','fr-circ':'ellipse',
  hex:'preparation',hexagon:'preparation',prepare:'preparation',doc:'document',document:'document','lin-doc':'document','tag-doc':'document',
  docs:'multidoc',documents:'multidoc','st-doc':'multidoc','stacked-document':'multidoc','sl-rect':'manualInput','manual-input':'manualInput',
  'trap-t':'manualOp',manual:'manualOp','inv-trapezoid':'manualOp','trap-b':'manualOp',trapezoid:'manualOp',delay:'delay',cloud:'cloud',
  person:'user',browser:'browser',text:'text'};
const mmClean=s=>htmlToText(String(s).replace(/^"|"$/g,'').replace(/^`|`$/g,'').replace(/#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/#(\w+);/g,'&$1;'));
function parseMermaid(src){
  const g=newGraph(), map=new Map(), classOf=new Map();
  const text=src.replace(/^\uFEFF/,'').replace(/^\s*---\r?\n[\s\S]*?\r?\n---\s*\r?\n/,'');
  let header=false;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim(); if(!line||line.startsWith('%%')) continue;
    for(let st of splitOutside(line,';')){
      st=st.trim(); if(!st) continue; let m;
      if(!header){
        m=st.match(/^(flowchart|graph)\b\s*(TB|TD|BT|RL|LR)?/i);
        if(!m) throw new Error('Mermaid text must start with "flowchart" or "graph". Only flowcharts can be imported.');
        header=true; const d=(m[2]||'TB').toUpperCase(); g.direction=d==='TD'?'TB':d; st=st.slice(m[0].length).trim(); if(!st) continue;
      }
      if(/^(subgraph|end|direction|classDef|style|linkStyle|click|accTitle|accDescr)\b/.test(st)) continue;
      if((m=st.match(/^class\s+([\w,\s]+?)\s+([\w-]+)$/))){ for(const id of m[1].split(',')) classOf.set(id.trim(),m[2]); continue; }
      mermaidChain(st,g,map,classOf);
    }
  }
  if(!header) throw new Error('the text is empty.');
  for(const [id,c] of classOf){ const n=map.get(id), k=c.replace(/^fe_/,''); if(n&&c.startsWith('fe_')&&SHAPES[k]&&!/^table(Header|Row)$/.test(k)) n.kind=k; }
  for(const n of g.nodes) if(n.kind==='table'){ const ls=n.label.split('\n'); n.label=ls[0]; n.columns=ls.slice(1); }
  dedupeEdges(g); return g;
}
const mmEnd=c=>c==='>'?'arrow':c==='o'?'circle':'none';
function mermaidChain(st,g,map,classOf){
  let pos=0; const ws=()=>{ while(pos<st.length&&/\s/.test(st[pos])) pos++; };
  const near=()=>JSON.stringify(st.slice(pos,pos+30));
  const node=()=>{
    ws(); const m=st.slice(pos).match(/^[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[.\-](?![-.>=]))*/u);
    if(!m) throw new Error(`Mermaid: expected a node name at ${near()}.`);
    const id=m[0]; pos+=id.length; const n=graphNode(g,map,id);
    if(st.startsWith('@{',pos)){
      const end=st.indexOf('}',pos); if(end<0) throw new Error(`Mermaid: missing "}" after ${id}@{.`);
      const body=st.slice(pos+2,end); pos=end+1;
      const sh=body.match(/shape\s*:\s*([\w-]+)/), lb=body.match(/label\s*:\s*"([^"]*)"/)||body.match(/label\s*:\s*([^,}]+)/);
      if(sh) n.kind=MM_SHAPES[sh[1].toLowerCase()]||'process'; if(lb) n.label=mmClean(lb[1].trim());
    } else {
      const opens=MM_OPEN.filter(o=>st.startsWith(o[0],pos));
      if(opens.length){
        const open=opens.reduce((a,b)=>b[0].length>a[0].length?b:a)[0], cands=opens.filter(o=>o[0]===open);
        let p=pos+open.length, label, close;
        if(st[p]==='"'){
          const q=st.indexOf('"',p+1); if(q<0) throw new Error(`Mermaid: unclosed quote in node ${id}.`);
          label=st.slice(p+1,q); p=q+1; while(st[p]===' ') p++;
          close=cands.find(c=>st.startsWith(c[1],p)); if(!close) throw new Error(`Mermaid: node ${id} is not closed properly.`); pos=p+close[1].length;
        } else {
          let best=null; for(const c of cands){ const i=st.indexOf(c[1],p); if(i>=0&&(!best||i<best.i)) best={i,c}; }
          if(!best) throw new Error(`Mermaid: missing "${cands[0][1]}" after node ${id}.`);
          label=st.slice(p,best.i); close=best.c; pos=best.i+close[1].length;
        }
        n.label=mmClean(label); n.kind=close[2];
      }
    }
    const cm=st.slice(pos).match(/^:::([\w-]+)/); if(cm){ classOf.set(id,cm[1]); pos+=cm[0].length; }
    return id;
  };
  const group=()=>{ const ids=[node()]; ws(); while(st[pos]==='&'){ pos++; ids.push(node()); ws(); } return ids; };
  const arrow=()=>{
    ws(); const rest=st.slice(pos);
    let m=rest.match(/^(?:\w+@)?(<)?(--|==|-\.)\s+(.+?)\s+(-{2,}|={2,}|\.-+)(>|o|x)?(?=\s|$|[\p{L}\p{N}_"])/u);   // A -- text --> B
    if(m){ pos+=m[0].length; return {label:mmClean(m[3]),style:m[2]==='-.'||m[4].startsWith('.')?'dotted':'solid',start:m[1]&&m[5]?'arrow':'none',end:mmEnd(m[5])}; }
    m=rest.match(/^(?:\w+@)?(<)?(-{2,}|={2,}|-\.+-|~{3,})(>|[ox](?=\s))?(?:\s*\|([^|]*)\|)?/);               // A -->|text| B
    if(m){ pos+=m[0].length; return {label:m[4]?mmClean(m[4].trim()):'',style:m[2].startsWith('-.')?'dotted':'solid',start:m[1]&&m[3]?'arrow':'none',end:mmEnd(m[3]),invisible:m[2].startsWith('~')}; }
    return null;
  };
  let left=group(); ws();
  while(pos<st.length){
    const a=arrow(); if(!a) throw new Error(`Mermaid: could not read ${near()}.`);
    const right=group();
    if(!a.invisible) for(const f of left) for(const t of right) g.edges.push({from:f,to:t,label:a.label,style:a.style,start:a.start,end:a.end});
    left=right; ws();
  }
}

/* ---------- PlantUML (both styles) ---------- */
function plantumlLines(src){
  const m=src.match(/@startuml[^\n]*\n([\s\S]*?)@enduml/i);
  if(!m&&/@start(?!uml)\w+/i.test(src)) throw new Error('only @startuml diagrams can be imported.');
  return (m?m[1]:src).replace(/\/'[\s\S]*?'\//g,'').split(/\r?\n/).map(l=>l.replace(/^\s*'.*$/,'').trim());
}
/* activity steps end in ; (or another activity terminator); :Actor: shorthand in component diagrams does not */
export const isActivityText=src=>/^\s*(?:start|stop|end|:[^\n]*[;|<>\/\]}]|if\s*\(.*\)\s*then\b.*|while\s*\(.*|repeat|fork|split)\s*$/im.test(plantumlLines(src).join('\n'));
const SKIP_PU=/^(?:(?:skinparam|title|caption|header|footer|hide|show|scale|allowmixing|left to right direction|top to bottom direction|legend|endlegend|together|newpage|left header|right header|center header|end note|endnote)\b|!|\}\s*$)/i;
function skipBlock(L,i,s){   // returns the index of the last line of a multi-line block starting at s, or i
  if(/^skinparam\b.*\{\s*$/i.test(s)){ while(i<L.length&&L[i]!=='}') i++; return i; }
  if(/^legend\b/i.test(s)){ while(i<L.length&&!/^endlegend\b/i.test(L[i])) i++; return i; }
  if(/^(note|hnote|rnote)\b/i.test(s)&&!/:/.test(s)){ while(i<L.length&&!/^end ?note\b/i.test(L[i])) i++; return i; }
  return -1;
}
const PU_ELEMENT=/^(actor\/?|agent|artifact|boundary|card|circle|cloud|collections|component|control|database|entity|file|folder|frame|hexagon|interface|label|node|package|person|process|queue|rectangle|stack|storage|usecase|action)\s+(.+)$/i;
const PU_REV={'-->':{t:'flow'},'<-->':{t:'both'},'..':{t:'assoc'},'--':{t:'association'},'..>':{t:'dependency'},'--|>':{t:'generalisation'},'..|>':{t:'realisation'},
  'o--':{t:'aggregation'},'*--':{t:'composition'},'<--':{t:'flow',rev:true},'<..':{t:'dependency',rev:true},'<|--':{t:'generalisation',rev:true},'<|..':{t:'realisation',rev:true},
  '--o':{t:'aggregation',rev:true},'--*':{t:'composition',rev:true}};
const normPuArrow=s=>s.replace(/"[^"]*"/g,'').replace(/\[[^\]]*\]/g,'').replace(/(left|right|down|up|le|ri|do|l|r|u|d)/g,'').replace(/\s+/g,'').replace(/-+/g,'--').replace(/\.+/g,'..');
function parsePlantUml(src){
  if(/^\s*\(\*\)/m.test(src)) throw new Error('the old PlantUML activity syntax with (*) is not supported. Use the newer syntax with start and stop.');
  const g=newGraph(), map=new Map(), L=plantumlLines(src); let skipped=0, firstSkipped='';
  const kindFor=(kw,stereo)=>{ const st=stereo&&Object.keys(SHAPES).find(k=>k.toLowerCase()===stereo.toLowerCase());
    return st&&!/^table(Header|Row)$/.test(st)?st:(PU_NATIVE[kw.toLowerCase()]||'process'); };
  const declare=(id,label,kind)=>{ const n=graphNode(g,map,id); n.label=label.replace(/\\n/g,'\n'); n.kind=kind;
    if(kind==='table'){ const ls=n.label.split('\n'); n.label=ls[0]; n.columns=ls.slice(1); } };
  const endpoint=(s,pos)=>{   // returns [id,newPos] for "Label", :Actor:, [Component], (Use case) or an id
    const rest=s.slice(pos); let m;
    if((m=rest.match(/^"([^"]*)"/))){ graphNode(g,map,m[1],{label:m[1].replace(/\\n/g,'\n')}); return [m[1],pos+m[0].length]; }
    if((m=rest.match(/^:([^:]+):/))){ graphNode(g,map,m[1],{label:m[1],kind:'user'}); return [m[1],pos+m[0].length]; }
    if((m=rest.match(/^\[([^\]]+)\]/))){ graphNode(g,map,m[1],{label:m[1],kind:'api'}); return [m[1],pos+m[0].length]; }
    if((m=rest.match(/^\(([^)]+)\)/))){ graphNode(g,map,m[1],{label:m[1],kind:'ellipse'}); return [m[1],pos+m[0].length]; }
    if((m=rest.match(/^[\p{L}\p{N}_.]+/u))){ graphNode(g,map,m[0]); return [m[0],pos+m[0].length]; }
    return null;
  };
  // optional "multiplicity" labels sit either side of the arrow; one is only taken on the right when another endpoint follows it
const ARROW=/^\s*(?:"[^"]*"\s*)?(<\|?|\*|o|\+|#|\^|\})?([-.=~]+)(?:\[[^\]]*\])?(?:left|right|up|down|le|ri|do|l|r|u|d)?([-.=~]*)(\|?>|\*|o|\+|#|\^|\{)?\s*(?:"[^"]*"\s*(?=[^\s:]))?/;
  for(let i=0;i<L.length;i++){
    let s=L[i]; if(!s) continue;
    const blockEnd=skipBlock(L,i,s); if(blockEnd>=0){ i=blockEnd; continue; }
    if(SKIP_PU.test(s)||/^(note|hnote|rnote)\b/i.test(s)) continue;
    let m=s.match(/^(?::([^:]+):|\[([^\]]+)\]|\(([^)]+)\))\s+as\s+([\p{L}\p{N}_.]+)$/u);   // :Actor: as A, [Component] as C, (Use case) as U
    if(m){ declare(m[4],m[1]||m[2]||m[3],m[1]?'user':m[2]?'api':'ellipse'); continue; }
    m=s.match(PU_ELEMENT);
    if(m){
      let rest=m[2].replace(/\{\s*$/,'').trim();
      const stereo=(rest.match(/<<\s*([^>]+?)\s*>>/)||[])[1]; rest=rest.replace(/<<[^>]*>>/g,'').replace(/\s#[\w#;:.\-]+/g,'').trim();
      // a line like `rectangle A --> B` is a link, not a declaration
      const isLink=/(^|\s)[<]?[-.=]{2,}[>]?(\s|$)/.test(rest)&&!/^"[^"]*"\s*(as\s+\S+)?$/.test(rest);
      if(!isLink){
        const kind=kindFor(m[1],stereo); let mm;
        if((mm=rest.match(/^"([^"]*)"\s+as\s+([\p{L}\p{N}_.]+)/u))) declare(mm[2],mm[1],kind);
        else if((mm=rest.match(/^([\p{L}\p{N}_.]+)\s+as\s+"([^"]*)"/u))) declare(mm[1],mm[2],kind);
        else if((mm=rest.match(/^([\p{L}\p{N}_.]+)\s*\[\s*$/u))){ const buf=[]; while(++i<L.length&&!/^\]/.test(L[i])) buf.push(L[i]); declare(mm[1],buf.join('\n').trim(),kind); }
        else if((mm=rest.match(/^([\p{L}\p{N}_.]+)\s*\[(.*)\]$/u))) declare(mm[1],mm[2].trim(),kind);
        else if((mm=rest.match(/^"([^"]*)"$/))) declare(mm[1],mm[1],kind);
        else if((mm=rest.match(/^([\p{L}\p{N}_.]+)$/u))) declare(mm[1],mm[1],kind);
        else { skipped++; firstSkipped=firstSkipped||s; }
        continue;
      }
      s=rest;
    }
    // link: endpoint arrow endpoint [: label]
    const a=endpoint(s,0); if(!a){ skipped++; firstSkipped=firstSkipped||s; continue; }
    const am=s.slice(a[1]).match(ARROW);
    if(!am||!/[-.=~]/.test(am[2]+am[3])){ if(s.slice(a[1]).trim()){ skipped++; firstSkipped=firstSkipped||s; } continue; }
    const bpos=a[1]+am[0].length, b=endpoint(s,bpos); if(!b){ skipped++; firstSkipped=firstSkipped||s; continue; }
    const label=(s.slice(b[1]).match(/^\s*:\s*(.*)$/)||[])[1]||'';
    const known=PU_REV[normPuArrow(am[0])]; let from=a[0], to=b[0], st;
    if(known){ st=typeStyle(known.t); if(known.rev) [from,to]=[to,from]; }
    else { const head=!!am[4], tail=!!am[1]; st={style:/\./.test(am[2]+am[3])?'dashed':'solid',start:tail&&head?'arrow':'none',end:head||tail?'arrow':'none'}; if(tail&&!head) [from,to]=[to,from]; }
    g.edges.push({from,to,label:label.replace(/\\n/g,'\n').trim(),...st});
  }
  if(skipped) g.warnings.push(`${plural(skipped,'line')} could not be read and ${skipped===1?'was':'were'} skipped, starting with: ${firstSkipped.slice(0,60)}`);
  dedupeEdges(g); return g;
}
function parseActivity(src){
  const g=newGraph(), map=new Map(), L=plantumlLines(src), stack=[], connectors=new Map();
  let auto=0, tails=[], endNode=null, skipped=0, firstSkipped='';
  const make=(kind,label)=>graphNode(g,map,'A'+(++auto),{kind,label});
  const edge=(f,t,label)=>g.edges.push({from:f.id,to:t.id,label:label||'',directed:true,both:false});
  const link=n=>{ for(const t of tails) edge(t.node,n,t.label); const top=stack[stack.length-1]; if(top&&top.type==='repeat'&&!top.first) top.first=n; tails=[{node:n}]; };
  const frame=(type,s,pop)=>{ const f=stack[stack.length-1]; if(!f||f.type!==type) throw new Error(`PlantUML: "${s}" has no matching ${type}.`); if(pop) stack.pop(); return f; };
  for(let i=0;i<L.length;i++){
    let s=L[i]; if(!s) continue; let m;
    const blockEnd=skipBlock(L,i,s); if(blockEnd>=0){ i=blockEnd; continue; }
    if(SKIP_PU.test(s)||/^(note|hnote|rnote|partition|group|end ?group|package|rectangle|card)\b/i.test(s)||/^\|.*\|/.test(s)||/^(label|goto)\s/i.test(s)) continue;
    if(/^start$/i.test(s)){ link(make('terminator','Start')); continue; }
    if(/^(stop|end)$/i.test(s)){ endNode=endNode||make('terminator','End'); link(endNode); tails=[]; continue; }
    if(/^(kill|detach)$/i.test(s)){ tails=[]; continue; }
    if((m=s.match(/^->\s*(.*?);?\s*$/))){ for(const t of tails) t.label=m[1]; continue; }
    if(s.startsWith(':')){
      let txt=s.slice(1); while(!/[;|<>\/\\\]}]\s*$/.test(txt)&&i+1<L.length) txt+='\n'+L[++i];
      txt=txt.trimEnd(); const end=txt.slice(-1); txt=txt.slice(0,-1);
      link(make(end==='|'?'subprocess':end==='/'?'data':'process',txt.replace(/\\n/g,'\n').trim())); continue;
    }
    if((m=s.match(/^if\s*\((.*?)\)\s*(?:is\s*\((.*?)\)\s*)?then\s*(?:\((.*?)\))?/i))){ const d=make('decision',m[1]); link(d); stack.push({type:'if',d,ends:[],hasElse:false}); tails=[{node:d,label:m[3]||m[2]||''}]; continue; }
    if((m=s.match(/^else\s*if\s*\((.*?)\)\s*(?:is\s*\((.*?)\)\s*)?then\s*(?:\((.*?)\))?/i))){   // drawn by PlantUML as a further diamond
      const f=frame('if',s); f.ends.push(...tails); const d2=make('decision',m[1]); edge(f.d,d2,''); f.d=d2; tails=[{node:d2,label:m[3]||m[2]||''}]; continue; }
    if((m=s.match(/^else\b\s*(?:\((.*?)\))?/i))){ const f=frame('if',s); f.ends.push(...tails); f.hasElse=true; tails=[{node:f.d,label:m[1]||''}]; continue; }
    if(/^end\s*if$/i.test(s)){ const f=frame('if',s,true); f.ends.push(...tails); if(!f.hasElse) f.ends.push({node:f.d,label:''}); tails=f.ends; continue; }
    if((m=s.match(/^while\s*\((.*?)\)\s*(?:is\s*\((.*?)\))?/i))){ const w=make('decision',m[1]); link(w); stack.push({type:'while',w}); tails=[{node:w,label:m[2]||''}]; continue; }
    if((m=s.match(/^end\s*while\b\s*(?:\((.*?)\))?/i))){ const f=frame('while',s,true); for(const t of tails) edge(t.node,f.w,t.label); tails=[{node:f.w,label:m[1]||''}]; continue; }
    if(/^repeat$/i.test(s)){ stack.push({type:'repeat',first:null}); continue; }
    if((m=s.match(/^repeat\s*while\s*\((.*?)\)\s*(?:is\s*\((.*?)\))?\s*(?:not\s*\((.*?)\))?/i))){
      const f=frame('repeat',s,true), r=make('decision',m[1]); link(r); if(f.first) edge(r,f.first,m[2]||''); tails=[{node:r,label:m[3]||''}]; continue; }
    if(/^(fork|split)$/i.test(s)){ stack.push({type:'fork',origin:tails.map(t=>({...t})),ends:[]}); continue; }
    if(/^(fork|split) again$/i.test(s)){ const f=frame('fork',s); f.ends.push(...tails); tails=f.origin.map(t=>({...t})); continue; }
    if(/^(end ?(fork|split|merge)|fork end)\b/i.test(s)){ const f=frame('fork',s,true); f.ends.push(...tails); tails=f.ends; continue; }
    if((m=s.match(/^\(([^)]+)\)$/))){ let c=connectors.get(m[1]); if(!c){ c=make('ellipse',m[1]); connectors.set(m[1],c); } link(c); continue; }
    skipped++; firstSkipped=firstSkipped||s;
  }
  if(stack.length) g.warnings.push(`The text ended inside an unfinished ${stack[stack.length-1].type} block.`);
  // a connector circle is a jump: join everything arriving at it straight to whatever leaves it
  for(const c of connectors.values()){
    const ins=g.edges.filter(e=>e.to===c.id), outs=g.edges.filter(e=>e.from===c.id); if(!outs.length) continue;
    g.edges=g.edges.filter(e=>e.to!==c.id&&e.from!==c.id);
    for(const a of ins) for(const b of outs) g.edges.push({from:a.from,to:b.to,label:a.label||b.label,directed:true,both:false});
    g.nodes=g.nodes.filter(n=>n!==c); map.delete(c.id);
  }
  if(skipped) g.warnings.push(`${plural(skipped,'line')} could not be read and ${skipped===1?'was':'were'} skipped, starting with: ${firstSkipped.slice(0,60)}`);
  dedupeEdges(g); return g;
}

/* ---------- Graphviz DOT ---------- */
function dotTokens(s){
  const t=[]; let i=0;
  while(i<s.length){
    const c=s[i];
    if(/\s/.test(c)){ i++; continue; }
    if(c==='/'&&s[i+1]==='/'){ while(i<s.length&&s[i]!=='\n') i++; continue; }
    if(c==='/'&&s[i+1]==='*'){ const e=s.indexOf('*/',i+2); i=e<0?s.length:e+2; continue; }
    if(c==='#'&&/(^|\n)[ \t]*$/.test(s.slice(Math.max(0,i-200),i))){ while(i<s.length&&s[i]!=='\n') i++; continue; }   // preprocessor-style line
    if(c==='"'){
      let j=i+1, v='';
      while(j<s.length&&s[j]!=='"'){ if(s[j]==='\\'&&s[j+1]==='"'){ v+='"'; j+=2; } else if(s[j]==='\\'&&s[j+1]==='\n'){ j+=2; } else if(s[j]==='\\'&&s[j+1]==='\r'&&s[j+2]==='\n'){ j+=3; } else v+=s[j++]; }
      if(j>=s.length) throw new Error('DOT: a quoted string is not closed.');
      i=j+1; const prev=t[t.length-1], prev2=t[t.length-2];
      if(prev&&prev.t==='+'&&prev2&&prev2.q){ t.pop(); prev2.v+=v; } else t.push({t:'id',v,q:true});
      continue;
    }
    if(c==='<'){ let d=0, j=i; do{ if(s[j]==='<') d++; else if(s[j]==='>') d--; j++; }while(j<s.length&&d>0); t.push({t:'id',v:s.slice(i+1,j-1),html:true}); i=j; continue; }
    if(s.startsWith('->',i)||s.startsWith('--',i)){ t.push({t:'edge',v:s.substr(i,2)}); i+=2; continue; }
    if('{}[];,=:+'.includes(c)){ t.push({t:c}); i++; continue; }
    const m=s.slice(i).match(/^(-?(?:\.\d+|\d+(?:\.\d*)?)|[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)/);
    if(!m) throw new Error(`DOT: unexpected character ${JSON.stringify(c)}.`);
    t.push({t:'id',v:m[0]}); i+=m[0].length;
  }
  return t;
}
const DOT_KIND={box:'process',rect:'process',rectangle:'process',square:'process',diamond:'decision',ellipse:'ellipse',oval:'ellipse',circle:'ellipse',
  doublecircle:'ellipse',point:'ellipse',cylinder:'database',note:'document',folder:'document',tab:'document',parallelogram:'data',hexagon:'preparation',
  octagon:'preparation',trapezium:'manualOp',invtrapezium:'manualOp',house:'offPage',invhouse:'offPage',component:'api',box3d:'server',
  plaintext:'text',plain:'text',none:'text',underline:'text',record:'process',mrecord:'process'};
const dotLabel=(s,id)=>s.replace(/\\N/g,id).replace(/\\[nlr]/g,'\n').replace(/\\(.)/g,'$1').replace(/\n+$/,'');
const DOT_REV={normal:'arrow',inv:'arrow',vee:'open',open:'open',onormal:'triangle',empty:'triangle',odiamond:'diamond',ediamond:'diamond',diamond:'fdiamond',
  odot:'circle',dot:'circle',teetee:'one',tee:'one',teeodot:'zeroOne',odottee:'zeroOne',crowtee:'oneMany',crow:'oneMany',teecrow:'oneMany',crowodot:'zeroMany',odotcrow:'zeroMany',none:'none'};
function parseDot(src){
  const tk=dotTokens(src), g=newGraph(), map=new Map(); let p=0;
  const peek=(k=0)=>tk[p+k], next=()=>tk[p++];
  const expect=t=>{ const x=next(); if(!x||x.t!==t) throw new Error(`DOT: expected "${t}"${x?` but found "${x.v||x.t}"`:' before the end'}.`); return x; };
  const kw=(x,k)=>x&&x.t==='id'&&!x.q&&x.v.toLowerCase()===k;
  if(kw(peek(),'strict')) p++;
  const gt=next(); if(!kw(gt,'graph')&&!kw(gt,'digraph')) throw new Error('DOT text must start with "graph" or "digraph".');
  const directed=gt.v.toLowerCase()==='digraph';
  if(peek()&&peek().t==='id') p++;
  expect('{');
  const attrs=()=>{ const a={};
    while(peek()&&peek().t==='['){ p++;
      while(peek()&&peek().t!==']'){ const k=next(); if(k.t!=='id') throw new Error('DOT: unreadable attribute list.');
        let v='true'; if(peek()&&peek().t==='='){ p++; const x=next(); if(!x||x.t!=='id') throw new Error(`DOT: attribute ${k.v} has no value.`); v=x.html?htmlToText(x.v):x.v; }
        a[k.v.toLowerCase()]=v; if(peek()&&(peek().t===','||peek().t===';')) p++; }
      expect(']'); }
    return a; };
  function endpoint(scope,ids){
    const x=peek();
    if(kw(x,'subgraph')||(x&&x.t==='{')){
      if(kw(x,'subgraph')){ p++; if(peek()&&peek().t==='id') p++; }
      expect('{'); const inner=stmts({node:{...scope.node}}); expect('}'); inner.forEach(v=>ids.add(v)); return [...inner];
    }
    const id=next(); if(!id||id.t!=='id') throw new Error('DOT: expected a node name.');
    while(peek()&&peek().t===':'){ p++; next(); }   // ports are ignored
    if(!map.has(id.v)) graphNode(g,map,id.v,{label:id.v,_a:{...scope.node}});
    ids.add(id.v); return [id.v];
  }
  function stmts(scope){
    const ids=new Set();
    while(peek()&&peek().t!=='}'){
      const x=peek();
      if(x.t===';'||x.t===','){ p++; continue; }
      if(kw(x,'graph')||kw(x,'node')||kw(x,'edge')){ p++; const a=attrs(); const k=x.v.toLowerCase();
        if(k==='node') Object.assign(scope.node,a); else if(k==='graph'&&a.rankdir) g.direction=a.rankdir.toUpperCase(); continue; }
      if(x.t==='id'&&peek(1)&&peek(1).t==='='){ p+=2; const v=next(); if(x.v.toLowerCase()==='rankdir'&&v) g.direction=v.v.toUpperCase(); continue; }
      const chain=[endpoint(scope,ids)];
      while(peek()&&peek().t==='edge'){ next(); chain.push(endpoint(scope,ids)); }
      const a=attrs();
      if(chain.length===1){ for(const id of chain[0]) Object.assign(map.get(id)._a,a); continue; }
      for(let i=0;i<chain.length-1;i++) for(const f of chain[i]) for(const t of chain[i+1]){
        const back=a.dir==='back', both=a.dir==='both', dir=directed&&a.dir!=='none';
        const mk2=v=>DOT_REV[String(v||'normal').toLowerCase()]||'arrow', style=/dotted/.test(a.style||'')?'dotted':/dashed/.test(a.style||'')?'dashed':'solid';
        const ends=back?{start:'none',end:mk2(a.arrowtail)}:both?{start:mk2(a.arrowtail),end:mk2(a.arrowhead)}:dir?{start:'none',end:mk2(a.arrowhead)}:{start:'none',end:'none'};
        g.edges.push({from:back?t:f,to:back?f:t,label:a.label?dotLabel(a.label,''):'',style,...ends});
      }
    }
    return ids;
  }
  stmts({node:{}}); expect('}');
  let positioned=g.nodes.length>0;
  for(const n of g.nodes){
    const a=n._a||{}; delete n._a;
    const shape=(a.shape||'').toLowerCase(), raw=a.label!=null?a.label:'\\N';
    const tagged=(a.comment||'').match(/^flow-editor:(\w+)$/);
    n.kind=tagged&&SHAPES[tagged[1]]&&!/^table(Header|Row)$/.test(tagged[1])?tagged[1]:shape?DOT_KIND[shape]||'process':'process';
    if(!tagged&&n.kind==='process'&&/rounded/.test(a.style||'')) n.kind='terminator';
    if((shape==='record'||shape==='mrecord')&&raw.includes('|')){
      const fields=raw.replace(/^\s*\{|\}\s*$/g,'').split(/(?<!\\)\|/).map(f=>f.replace(/<[^>]*>/g,'').trim());
      n.kind='table'; n.label=dotLabel(fields[0],n.id);
      n.columns=fields.slice(1).flatMap(f=>dotLabel(f,n.id).split('\n')).map(c=>c.trim()).filter(Boolean);
    } else n.label=dotLabel(raw,n.id);
    const pos=(a.pos||'').match(/^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
    if(pos){ n._px=+pos[1]; n._py=+pos[2]; n.w=clampN(parseFloat(a.width),0.2,20,1.5); n.h=clampN(parseFloat(a.height),0.2,20,0.75); } else positioned=false;
  }
  if(positioned){   // Graphviz output: pos is the centre in points (1/72 inch) with y pointing up
    const maxY=Math.max(...g.nodes.map(n=>n._py));
    for(const n of g.nodes){ n.x=n._px/72-n.w/2; n.y=(maxY-n._py)/72-n.h/2; }
    g.positioned=true;
  }
  for(const n of g.nodes){ delete n._px; delete n._py; }
  dedupeEdges(g); return g;
}

/* ---------- draw.io ---------- */
async function inflateDrawio(b64){
  if(typeof DecompressionStream==='undefined') throw new Error('this browser cannot read compressed draw.io files. In draw.io, turn off compression in the file properties and save again.');
  let bytes; try{ bytes=Uint8Array.from(atob(b64.replace(/\s+/g,'')),c=>c.charCodeAt(0)); }catch(_){ throw new Error('draw.io: the page data is not valid.'); }
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), parts=[]; let size=0;
  for(;;){ const {done,value}=await reader.read(); if(done) break; size+=value.length;
    if(size>MAX_IMPORT_CHARS*4){ await reader.cancel(); throw new Error('draw.io: the page is too large to import.'); } parts.push(value); }
  const text=new TextDecoder().decode(await new Blob(parts).arrayBuffer());
  try{ return decodeURIComponent(text); }catch(_){ return text; }
}
const parseStyle=s=>{ const o={}; s.split(';').forEach((kv,i)=>{ if(!kv) return; const j=kv.indexOf('='); if(j<0){ if(i===0) o._base=kv; o[kv]='1'; } else o[kv.slice(0,j)]=kv.slice(j+1); }); return o; };
function drawioKind(st){
  if(st.flowEditorKind&&SHAPES[st.flowEditorKind]&&!/^table(Header|Row)$/.test(st.flowEditorKind)) return st.flowEditorKind;
  const sh=(st.shape||'').toLowerCase(), base=(st._base||'').toLowerCase(), f=sh.replace('mxgraph.flowchart.','');
  if(base==='text'||sh==='text') return 'text';
  if(base==='rhombus'||sh==='rhombus'||f==='decision') return 'decision';
  if(sh==='cloud') return 'cloud';
  if(base==='ellipse'||sh==='ellipse'||/^(start_1|start_2|on-page_reference|or|summing_function)$/.test(f)) return 'ellipse';
  if(f==='terminator'||(st.rounded==='1'&&+(st.arcSize||0)>=40)) return 'terminator';
  const m={parallelogram:'data',data:'data',process:'subprocess',predefined_process:'subprocess',cylinder:'database',cylinder3:'database',datastore:'database',
    database:'database',stored_data:'database',document:'document','multi-document':'multidoc',manualinput:'manualInput',manual_input:'manualInput',
    trapezoid:'manualOp',manual_operation:'manualOp',hexagon:'preparation',preparation:'preparation',delay:'delay',offpageconnector:'offPage',
    'off-page_reference':'offPage',umlactor:'user',component:'api',note:'document'};
  return m[f.toLowerCase()]||m[sh]||'process';
}
async function parseDrawio(src){
  const g=newGraph(); g.positioned=true;
  let doc; try{ doc=parseXml(src.trim()); }catch(_){ throw new Error('draw.io: the file is not valid XML.'); }
  let model=null; const root=doc.documentElement;
  if(root.localName==='mxGraphModel') model=root;
  else if(root.localName==='mxfile'){
    const ds=[...root.getElementsByTagName('diagram')]; if(!ds.length) throw new Error('draw.io: the file has no pages.');
    if(ds.length>1) g.warnings.push(`Only the first of ${ds.length} draw.io pages was imported.`);
    model=ds[0].getElementsByTagName('mxGraphModel')[0]||null;
    if(!model){ const txt=ds[0].textContent.trim(); if(!txt) throw new Error('draw.io: the first page is empty.');
      try{ model=parseXml(await inflateDrawio(txt)).documentElement; }catch(e){ throw e.message.startsWith('draw.io')||e.message.startsWith('this browser')?e:new Error('draw.io: the compressed page could not be read.'); } }
  } else throw new Error('this is not a draw.io file.');
  const rootEl=model.getElementsByTagName('root')[0]; if(!rootEl) throw new Error('draw.io: the page has no content.');
  const cells=new Map();
  for(const el of rootEl.children){
    let c=el, value=null;
    if(el.localName==='object'||el.localName==='UserObject'){ c=el.getElementsByTagName('mxCell')[0]; value=el.getAttribute('label'); if(!c) continue; }
    else if(el.localName!=='mxCell') continue;
    const st=parseStyle(c.getAttribute('style')||'');
    cells.set(el.getAttribute('id'),{id:el.getAttribute('id'),parent:c.getAttribute('parent'),style:st,
      text:(st.html==='1'?htmlToText:x=>x)(value??c.getAttribute('value')??''),vertex:c.getAttribute('vertex')==='1',edge:c.getAttribute('edge')==='1',
      source:c.getAttribute('source'),target:c.getAttribute('target'),geo:c.getElementsByTagName('mxGeometry')[0]||null});
  }
  if(cells.size>MAX_NODES*3) throw new Error('draw.io: the page is too large to import.');
  const gv=(c,k,d)=>clampN(parseFloat(c.geo&&c.geo.getAttribute(k)),-1e5,1e5,d);
  const abs=new Map(), absPos=c=>{ if(abs.has(c.id)) return abs.get(c.id); const p=cells.get(c.parent);
    const o=p&&p.vertex?absPos(p):[0,0], r=[o[0]+gv(c,'x',0),o[1]+gv(c,'y',0)]; abs.set(c.id,r); return r; };
  const owner=new Map(), byCell=new Map(), map=new Map();
  for(const c of cells.values()){
    if(!c.vertex) continue; const p=cells.get(c.parent);
    if(p&&p.edge) continue;                           // edge label, handled below
    if(owner.has(c.id)) continue;
    if(c.style._base==='group'&&![...cells.values()].some(x=>x.parent===c.id&&x.text)) continue;
    const [x,y]=absPos(c), kind=drawioKind(c.style), hex=v=>/^#[0-9a-f]{6}$/i.test(v||'')?v.toUpperCase():null;
    const n=graphNode(g,map,c.id,{kind,label:c.text,x:x/DRAWIO_PPI,y:y/DRAWIO_PPI,w:clampN(gv(c,'width',120)/DRAWIO_PPI,0.1,20,1.2),h:clampN(gv(c,'height',60)/DRAWIO_PPI,0.1,20,0.6),
      fill:hex(c.style.fillColor),line:hex(c.style.strokeColor),textColour:hex(c.style.fontColor)});
    if(c.style._base==='swimlane'||kind==='table'){   // a draw.io entity or table: its child rows become columns
      const rows=[...cells.values()].filter(r=>r.parent===c.id&&r.vertex).sort((a,b)=>gv(a,'y',0)-gv(b,'y',0));
      n.kind='table'; n.columns=rows.map(r=>r.text).filter(Boolean); rows.forEach(r=>owner.set(r.id,c.id));
    }
    byCell.set(c.id,c.id);
  }
  for(const [child,parent] of owner){ byCell.set(child,parent); const n=map.get(child); if(n){ g.nodes=g.nodes.filter(x=>x!==n); map.delete(child); } }
  let floating=0;
  for(const c of cells.values()){
    if(!c.edge) continue;
    const from=byCell.get(c.source), to=byCell.get(c.target);
    if(!from||!to){ floating++; continue; }
    const extra=[...cells.values()].filter(x=>x.parent===c.id&&x.text).map(x=>x.text);
    const st=c.style, style=st.dashed==='1'?(/^\s*[0-2](\s|$)/.test(st.dashPattern||'')?'dotted':'dashed'):'solid';
    g.edges.push({from,to,label:[c.text,...extra].filter(Boolean).join(' '),style,start:dioMarker(st.startArrow??'none',st.startFill),end:dioMarker(st.endArrow??'classic',st.endFill)});
  }
  if(floating) g.warnings.push(`${plural(floating,'connector')} not attached at both ends ${floating===1?'was':'were'} left out.`);
  dedupeEdges(g); return g;
}

export let IMPORTERS;
export function detectFormat(t){
  const s=t.trim();
  if(/^<(\?xml[^>]*>\s*)?<?(mxfile|mxGraphModel)\b/.test(s)||(/^</.test(s)&&/<mx(file|GraphModel)\b/.test(s))) return 'drawio';
  if(/@startuml/i.test(s)) return 'plantuml';
  if(/^(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|#[^\n]*\n|\s)*(?:strict\s+)?(?:di)?graph\b[^{\n]*\{/i.test(s)) return 'dot';
  if(/^(?:---[\s\S]*?---\s*)?(?:%%[^\n]*\n\s*)*(?:flowchart|graph)\b/i.test(s)) return 'mermaid';
  return null;
}
/* text pasted from Markdown often arrives inside a ```mermaid fence */
export const unfence=t=>{ const m=t.match(/```[ \t]*(?:mermaid|plantuml|puml|dot|graphviz|xml)?[ \t]*\r?\n([\s\S]*?)```/i); return m?m[1]:t; };

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  IMPORTERS={mermaid:parseMermaid,plantuml:t=>isActivityText(t)?parseActivity(t):parsePlantUml(t),activity:parseActivity,dot:parseDot,drawio:parseDrawio};
}
