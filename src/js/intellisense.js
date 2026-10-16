/* ---------- IntelliSense for the .flow text ----------
   Suggests what can come next at the caret: statements and shape ids at the start of a line, shape types after
   "id:", connection types after a shape id, shape ids after a connection, settings inside [ ] and their values,
   and page options. It opens as you type; Ctrl+Space opens it anywhere. Arrows move, Enter or Tab accepts,
   Escape closes. Nothing is suggested inside quoted text or comments. */
import {$, S} from './core.js';
import {CONN, LINE_STYLES, MARKERS} from './flow/model.js';
import {FLOW_KINDS, KIND_ALIASES, splitComment} from './flow/language.js';
import {TP} from './text-pane.js';

const MAX_SHOWN=50;
const ID='[A-Za-z_][\\w-]*';
const STATEMENTS=[['page','Start a page: page "Name" size 297x210'],['key','Add the key that explains the lines'],['icon','Define a picture: icon name "data:image/svg+xml;base64,..."']];
const SHAPE_SETTINGS={fill:'Fill colour',stroke:'Line colour',text:'Text colour',weight:'Line weight in points',size:'Text size in points',icon:'Picture kept from an import'};
const LINE_SETTINGS={style:'Line pattern',start:'Line end at the start',end:'Line end at the finish',stroke:'Line colour',weight:'Line weight in points',
  size:'Label size in points',text:'Label colour',means:'Meaning shown in the key',route:'Straight or right-angled',via:'Bend points in mm, like "40,20 40,60"'};
const COLOURS=[['#FA4616','Blood Orange'],['#00B5E2','Cyan'],['#44D62C','Green'],['#DCE3EB','Silver'],['#282822','Charcoal'],['#FFFFFF','White'],
  ['#F0A63E','Yellow'],['#50B29C','Teal'],['#006F8E','Harbor Blue'],['#2B3A47','Default line']];
const PAGE_SIZES=[['297x210','A4 landscape'],['210x297','A4 portrait'],['420x297','A3 landscape'],['594x420','A2 landscape'],['841x594','A1 landscape']];
const DIRECTIONS=[['TB','Top to bottom'],['LR','Left to right'],['BT','Bottom to top'],['RL','Right to left']];
const POINTS=w=>w.map(v=>[String(v),v+' pt']);
const VALUES={
  fill:COLOURS,stroke:COLOURS,text:COLOURS,
  weight:POINTS([0.5,0.75,1,1.5,2,3]),size:POINTS([8,9,10,11,12,14,18,24]),
  style:Object.keys(LINE_STYLES).map(k=>[k,'']),start:Object.entries(MARKERS),end:Object.entries(MARKERS),
  route:[['straight','A direct line'],['elbow','Right angles, routed round shapes']],
  icon:()=>[...(S.ast&&S.ast.icons?S.ast.icons.keys():[])].map(n=>[n,'Icon defined in this document']),
};
const CONNECTIONS=Object.values(CONN).filter(c=>c.token).map(c=>[c.token,`${c.name}: ${c.means}`])
  .concat([['||--o{','One to many (database)'],['||--||','One to one (database)'],['}o--o{','Many to many (database)']]);
let kindHelp={};

let codeText, box, items=[], active=0, range=null;

/* The page the caret is on, by line number */
function pageAt(line){
  const pages=(S.ast&&S.ast.pages)||[]; let p=pages[0];
  for(const ap of pages) if(ap.headerLine!=null&&ap.headerLine<=line) p=ap;
  return p;
}
const shapeIds=(line,skip)=>{ const ap=pageAt(line); return ap?ap.shapes.filter(d=>!d.implicit&&d.id!==skip).map(d=>[d.id,d.label||d.kind]):[]; };
const isConnectionToken=t=>CONNECTIONS.some(([tok])=>tok===t)||/^[|}][|o](--|\.\.)[|o][|{]$/.test(t);

/* What can be typed at the caret: {start, items:[[insert, detail]], kind} or null */
function suggestionsAt(text,caret){
  const lineStart=text.lastIndexOf('\n',caret-1)+1, before=text.slice(lineStart,caret), line=text.slice(0,caret).split('\n').length-1;
  if(splitComment(before).code.length<before.length) return null;                          // in a comment
  if(((before.replace(/\\./g,'').match(/"/g)||[]).length)%2) return null;                   // in quoted text
  const tail=re=>{ const m=before.match(re); return m?{start:caret-m[m.length-1].length,word:m[m.length-1]}:null; };
  let m, t;
  // inside a settings list
  if((m=before.match(/\[([^\]]*)$/))){
    const shape=new RegExp(`^\\s*${ID}\\s*:`).test(before), names=shape?SHAPE_SETTINGS:LINE_SETTINGS;
    const v=m[1].match(/([A-Za-z]+)=([^\s\]]*)$/);
    if(v){ const opts=VALUES[v[1].toLowerCase()]; if(!opts) return null;
      return {start:caret-v[2].length,word:v[2],kind:'value',items:(typeof opts==='function'?opts():opts).map(([k,d])=>[k,d])}; }
    const used=new Set([...m[1].matchAll(/([A-Za-z]+)=/g)].map(x=>x[1].toLowerCase()));
    t=tail(/(?:^|[\s[])([A-Za-z]*)$/); if(!t) return null;
    return {...t,kind:'setting',items:Object.entries(names).filter(([k])=>!used.has(k)).map(([k,d])=>[k+'=',d])};
  }
  // page options
  if(/^\s*page\b/i.test(before)){
    if((t=tail(/\bdirection\s+([A-Za-z]*)$/i))) return {...t,kind:'value',items:DIRECTIONS};
    if((t=tail(/\bsize\s+([\dx.]*)$/i))) return {...t,kind:'value',items:PAGE_SIZES};
    if(/"[^"]*"\s/.test(before)&&(t=tail(/\s([A-Za-z]*)$/))) return {...t,kind:'setting',items:[['size ','Page size in mm'],['direction ','Layout direction for automatic placing']]};
    return null;
  }
  // shape type after "id:"
  if((t=tail(new RegExp(`^\\s*${ID}\\s*:\\s*([A-Za-z]*)$`))))
    return {...t,kind:'kind',items:[...FLOW_KINDS.map(k=>[k,kindHelp[k]||'']),...Object.entries(KIND_ALIASES).map(([a,k])=>[a,`Same as ${k}`])]};
  // shape id after a connection
  if((m=before.match(new RegExp(`^\\s*(${ID})\\s+(\\S+)\\s+(${ID})?$`)))&&isConnectionToken(m[2])){
    const word=m[3]||''; return {start:caret-word.length,word,kind:'id',items:shapeIds(line,m[1])};
  }
  // connection type after a shape id
  if((m=before.match(new RegExp(`^\\s*(${ID})\\s+(\\S*)$`)))&&!/^(page|key|icon|flow)$/i.test(m[1]))
    return {start:caret-m[2].length,word:m[2],kind:'conn',items:CONNECTIONS};
  // start of a line: a statement, or a shape id to start a connection
  if((t=tail(new RegExp(`^\\s*(${ID}|)$`))))
    return {...t,kind:'start',items:[...STATEMENTS,...shapeIds(line).map(([id,l])=>[id,`Connect from: ${l}`])]};
  return null;
}

function rank(list,word){
  const w=word.toLowerCase(), starts=[], has=[];
  for(const it of list){ const k=it[0].toLowerCase(); if(k.startsWith(w)) starts.push(it); else if(w&&k.includes(w)) has.push(it); }
  return [...starts,...has];
}
/* Opens or refreshes the list. force: Ctrl+Space, which also shows suggestions before anything is typed. */
function update(force){
  if(TP.mode!=='flow'||codeText.selectionStart!==codeText.selectionEnd){ close(); return; }
  const caret=codeText.selectionStart, ctx=suggestionsAt(codeText.value,caret);
  if(!ctx){ close(); return; }
  const prev=codeText.value[caret-1]||'', trigger=/[\s:[=>]/.test(prev);
  if(!force&&!ctx.word&&(!trigger||ctx.kind==='start')){ close(); return; }
  items=rank(ctx.items,ctx.word).slice(0,MAX_SHOWN);
  if(!items.length||(!force&&items.length===1&&items[0][0]===ctx.word)){ close(); return; }
  range={start:ctx.start,end:caret,kind:ctx.kind}; active=0; draw(); place();
}
function draw(){
  box.replaceChildren(...items.map(([label,detail],i)=>{
    const li=document.createElement('li'); li.id='sg-'+i; li.setAttribute('role','option'); li.setAttribute('aria-selected',String(i===active));
    const a=document.createElement('span'); a.className='sg-label'; a.textContent=label.trim();
    const b=document.createElement('span'); b.className='sg-detail'; b.textContent=detail;
    li.append(a,b); li.addEventListener('mousedown',e=>{ e.preventDefault(); active=i; accept(); }); return li; }));
  box.hidden=false; codeText.setAttribute('aria-expanded','true'); codeText.setAttribute('aria-activedescendant','sg-'+active);
  const li=box.children[active]; if(li) li.scrollIntoView({block:'nearest'});
}
let charW=0;
/* Under the start of the word being completed. The code font is monospaced with 18 px lines. */
function place(){
  if(!charW){ const c=document.createElement('canvas').getContext('2d'); c.font=getComputedStyle(codeText).font; charW=c.measureText('0').width||7.5; }
  const before=codeText.value.slice(0,range.start), line=before.split('\n').length-1, col=before.length-before.lastIndexOf('\n')-1;
  const pad=parseFloat(getComputedStyle(codeText).paddingLeft)||10, top=8+(line+1)*18-codeText.scrollTop, left=pad+col*charW-codeText.scrollLeft;
  const host=codeText.parentElement.getBoundingClientRect();
  box.style.top=(top+box.offsetHeight>host.height&&top>box.offsetHeight+18?top-18-box.offsetHeight:top)+'px';
  box.style.left=Math.max(0,Math.min(left,host.width-box.offsetWidth-4))+'px';
}
function close(){ if(box.hidden) return; box.hidden=true; items=[]; range=null; codeText.setAttribute('aria-expanded','false'); codeText.removeAttribute('aria-activedescendant'); }
function accept(){
  const it=items[active]; if(!it||!range) return;
  let insert=it[0], back=0;
  if(range.kind==='kind'){ insert+=' ""'; back=1; }                 // the label goes in the quotes
  else if(range.kind==='conn') insert+=' ';
  codeText.focus(); codeText.setSelectionRange(range.start,range.end);
  document.execCommand('insertText',false,insert);                 // keeps the browser's undo history
  if(back) codeText.setSelectionRange(codeText.selectionStart-back,codeText.selectionStart-back);
  close();
  if(/[=\s]$/.test(insert)) update(true);                            // straight on to the value or the next shape
}

export function init(){
  codeText=$('codeText'); box=$('suggest');
  for(const b of document.querySelectorAll('.palette [data-kind]')) kindHelp[b.dataset.kind]=b.title||b.textContent.trim();
  codeText.setAttribute('aria-autocomplete','list'); codeText.setAttribute('aria-controls','suggest'); codeText.setAttribute('aria-expanded','false');
  // capture, so the list handles its keys before the text pane uses Tab to indent and Escape to leave
  codeText.addEventListener('keydown',e=>{
    if(e.key===' '&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); update(true); return; }
    if(box.hidden) return;
    const n=items.length, take=()=>{ e.preventDefault(); e.stopImmediatePropagation(); };
    if(e.key==='ArrowDown'){ take(); active=(active+1)%n; draw(); }
    else if(e.key==='ArrowUp'){ take(); active=(active-1+n)%n; draw(); }
    else if(e.key==='PageDown'){ take(); active=Math.min(n-1,active+8); draw(); }
    else if(e.key==='PageUp'){ take(); active=Math.max(0,active-8); draw(); }
    else if(e.key==='Enter'||e.key==='Tab'){ take(); accept(); }
    else if(e.key==='Escape'){ take(); close(); }
    else if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) close();
  },true);
  codeText.addEventListener('input',e=>{ if(e.inputType&&!e.inputType.startsWith('insert')){ if(!box.hidden) update(); return; } update(); });
  codeText.addEventListener('blur',close);
  codeText.addEventListener('click',close);
  codeText.addEventListener('scroll',()=>{ if(!box.hidden) place(); });
}
