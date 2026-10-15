/* ---------- graph model to statements (imports and Visio) ---------- */
import {$, DEF, MM, NS, PRNS, RNS, S, XML_DECL, kid, kids, ser, toast} from './core.js';
import {blankFiles, parsePackage} from './visio-package.js';
import {SHAPES, roleOf} from './shapes.js';
import {commitText} from './text-editor.js';
import {downloadBlob} from './properties.js';
import {MAX_IMPORT_CHARS, pageGraph, plural, xmlEsc} from './formats/export.js';
import {render} from './render.js';
import {openImport} from './dialogs.js';
import {IMPORTERS, detectFormat, unfence} from './formats/import.js';
import {layoutGraph} from './layout.js';
import {applyTags, MARKERS, setUser, SHAPE_TEXT_PT, userV, VISIO_CONFIRMED} from './flow/model.js';
import {autoSizeMM, edgeStmt, FLOW_ID, FLOW_KINDS, iconStmt, keyStmt, pageStmt, shapeStmt, tableH, uniqueFid} from './flow/language.js';
import {LOOSE_GAP, PAGE_MARGIN, geoMM} from './flow/sync.js';
import {editDoc, loadText, setDirty} from './document.js';
import {TP, applyFromEditor} from './text-pane.js';

export function graphStatements(g,{ox=PAGE_MARGIN,oy=PAGE_MARGIN,used=new Set(),placed=true,relabel=false}={}){
  const ids=new Map(), lines=[];
  for(const n of g.nodes){
    const want=String(n.id), id=!relabel&&FLOW_ID.test(want)&&!used.has(want)&&!['key','page','flow'].includes(want.toLowerCase())?want:uniqueFid(n.label||n.kind,used);
    used.add(id); ids.set(n.id,id);
  }
  for(const n of g.nodes){
    const kind=FLOW_KINDS.includes(n.kind)?n.kind:'process', auto=autoSizeMM({kind,label:n.label,columns:n.columns});
    const w=n.w!=null?n.w*25.4:auto.w, h=n.h!=null?n.h*25.4:auto.h;
    const sized=Math.abs(w-auto.w)>0.6||(kind!=='table'&&Math.abs(h-auto.h)>0.6);
    const place=n.keepPlace!==undefined?n.keepPlace:placed&&n.x!=null?{x:ox+n.x*25.4,y:oy+n.y*25.4,w:sized?w:null,h:sized?(kind==='table'?tableH(n.columns):h):null}:null;
    const hex=v=>v&&/^#[0-9a-f]{6}$/i.test(v)?v.toUpperCase():null, T=SHAPES[kind];
    const attrs=n.keepAttrs||(kind==='table'?{}:{fill:hex(n.fill)&&hex(n.fill)!==(T.fill||DEF.fill).toUpperCase()?hex(n.fill):null,
      stroke:hex(n.line)&&hex(n.line)!==DEF.line.toUpperCase()?hex(n.line):null,text:hex(n.textColour)&&hex(n.textColour)!==(T.textColour||DEF.text).toUpperCase()?hex(n.textColour):null,
      icon:n.iconRef||null,size:n.size&&Math.abs(n.size-SHAPE_TEXT_PT)>0.01?n.size:null});
    lines.push(shapeStmt({id:ids.get(n.id),kind,label:n.label||'',columns:kind==='table'?(n.columns&&n.columns.length?n.columns:['column']):null,place,attrs}));
  }
  for(const e of g.edges){
    const from=ids.get(e.from), to=ids.get(e.to); if(!from||!to||from===to) continue;
    const via=placed&&e.route==='elbow'&&e.via?e.via.map(([x,y])=>[ox+x*25.4,oy+y*25.4]):null;   // bends are in inches, like node positions
    lines.push(edgeStmt({from,to,style:e.style||'solid',start:e.start||'none',end:e.end||(e.directed===false?'none':'arrow'),means:e.means||'',stroke:e.stroke||null,weight:e.weight||null,size:e.size||null,label:e.label||'',route:e.route||null,via}));
  }
  return {lines,ids};
}
const nextPageName=(base='Imported')=>{ let i=1; while(S.ast.pages.some(p=>p.name===`${base}-${i}`)) i++; return `${base}-${i}`; };
export function replacePageBody(text,ap,newLines){
  const L=text.split('\n'), start=ap.headerLine==null?0:ap.headerLine+1, end=ap.endLine;
  let keep=end; while(keep>=start&&!L[keep].trim()) keep--;   // keep blank lines between pages
  L.splice(start,Math.max(0,keep-start+1),...newLines); return L.join('\n');
}
export async function importGraph(g,dest){
  if(!g.nodes.length) throw new Error('no shapes were found to import.');
  applyTags(g); layoutGraph(g);
  const ap=S.ast.pages[S.pi];
  if(dest==='new'){
    const {lines}=graphStatements(g), name=nextPageName();
    editDoc(S.text.replace(/\s*$/,'\n')+'\n'+pageStmt({name,direction:g.direction})+'\n'+lines.join('\n')+'\n',S.ast.pages.length);
  } else if(dest==='replace'){
    const {lines}=graphStatements(g); editDoc(replacePageBody(S.text,ap,lines),S.pi);
  } else {
    const built=S.built[S.pi]; let ox=PAGE_MARGIN, oy=PAGE_MARGIN;
    if(built&&built.size){ ox=Math.max(...[...built.values()].map(b=>b.x+b.w))+LOOSE_GAP*2; oy=Math.min(...[...built.values()].map(b=>b.y)); }
    const {lines}=graphStatements(g,{ox,oy,used:new Set(ap.shapes.map(d=>d.id))});
    const L=S.text.split('\n'); let at=ap.endLine; while(at>(ap.headerLine??-1)&&!L[at].trim()) at--;
    L.splice(at+1,0,...lines); editDoc(L.join('\n'),S.pi);
  }
}

/* ---------- Visio import and export ---------- */
/* Reads every page of a .vsdx into the graph model, leaving the open document untouched */
export async function readVisio(buf){
  let zip; try{ zip=await JSZip.loadAsync(buf); }catch(_){ throw new Error('that is not a .vsdx package. Open older .vsd files in Visio and save them as .vsdx first.'); }
  const keep={zip:S.zip,pages:S.pages,masters:S.masters,styles:S.styles,pi:S.pi}, out=[];
  S.zip=zip;
  try{
    await parsePackage();
    for(let i=0;i<S.pages.length;i++){
      S.pi=i; const pg=S.pages[i], g=pageGraph();
      const top=kids(kid(pg.doc.documentElement,'Shapes'),'Shape');
      const key=top.find(el=>roleOf(el)==='key');   // a key this editor wrote comes back as a key
      out.push({name:pg.name+(pg.bg?' (background)':''),size:[pg.w*25.4,pg.h*25.4],g,
        key:key?{title:userV(key,'FlowKeyTitle')||'Key',place:geoMM(key,pg)}:null});
    }
  } finally { Object.assign(S,keep); render(); }   // reading draws each Visio page, so put the open page back
  return out;
}
/* Imports a Visio drawing. Its first page goes where dest says (a new page, replacing this page, or beside what
   is on this page); any further pages are added as new pages. Shapes keep their places and connectors their routes. */
export async function importVisio(buf,name,dest){
  const pages=await readVisio(buf);
  if(!pages.some(p=>p.g.nodes.length)) throw new Error('no shapes were found in that drawing.');
  const iconLines=nameIcons(pages.flatMap(p=>p.g.nodes));
  const ap=S.ast.pages[S.pi], used=new Set(ap.shapes.map(d=>d.id));
  const pageText=(p,opts)=>{ const lines=graphStatements(p.g,{ox:0,oy:0,used:new Set(),relabel:true,...opts}).lines;
    if(p.key) lines.push(keyStmt({title:p.key.title,place:{x:p.key.place.x,y:p.key.place.y}})); return lines; };
  const newPage=p=>'\n'+pageStmt({name:uniquePageName(p.name),size:p.size})+'\n'+pageText(p).join('\n')+'\n';
  const [first,...rest]=pages; let text=S.text, focus=S.pi;
  if(dest==='replace'){
    text=replacePageBody(text,ap,pageText(first));
    if(ap.headerLine!=null){ const L=text.split('\n'); L[ap.headerLine]=pageStmt({name:ap.name,size:first.size,direction:ap.direction}); text=L.join('\n'); }   // take the Visio page size too
  }
  else if(dest==='add'){
    const built=S.built[S.pi]; let ox=0;
    if(built&&built.size) ox=Math.max(...[...built.values()].map(b=>b.x+b.w))+LOOSE_GAP*2;
    const L=text.split('\n'); let at=ap.endLine; while(at>(ap.headerLine??-1)&&!L[at].trim()) at--;
    L.splice(at+1,0,...pageText(first,{ox,used})); text=L.join('\n');
  } else { text=text.replace(/\s*$/,'\n')+newPage(first); focus=S.ast.pages.length; }
  for(const p of rest) text=text.replace(/\s*$/,'\n')+newPage(p);
  editDoc(addIconLines(text,iconLines),focus);
  const nodes=pages.flatMap(p=>p.g.nodes), icons=nodes.filter(n=>n.iconRef).length, warnings=pages.flatMap(p=>p.g.warnings);
  toast(`Imported ${name}${pages.length>1?` (${plural(pages.length,'page')})`:''}: ${plural(nodes.length,'shape')}`
    +(icons?`, ${icons} of them icons kept as pictures`:'')+'. Shapes take the editor\'s nearest equivalent, so some Visio formatting is not kept.'
    +(warnings.length?' '+warnings.join(' '):''),9000);
}
/* Gives each distinct icon picture a name (reusing one already in the document for the same picture), sets
   n.iconRef on the nodes that use it, and returns the icon lines the document still needs */
function nameIcons(nodes){
  const known=new Map([...S.ast.icons].map(([name,data])=>[data,name])), taken=new Set(S.ast.icons.keys()), lines=[];
  for(const n of nodes){ if(!n.icon) continue;
    let name=known.get(n.iconKey)||known.get(n.icon);
    if(!name){
      const base=String(n.iconName||'icon').toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').replace(/^(?=\d)/,'i_')||'icon';
      name=base; for(let i=2;taken.has(name);i++) name=`${base}_${i}`;
      taken.add(name); known.set(n.icon,name); if(n.iconKey) known.set(n.iconKey,name); lines.push(iconStmt(name,n.icon));
    }
    n.iconRef=name;
  }
  return lines;
}
/* Icon lines sit under the "flow 1" header, before the first page */
function addIconLines(text,lines){
  if(!lines.length) return text;
  const L=text.split('\n'), at=L.findIndex(l=>/^\s*flow\s/i.test(l));
  L.splice(at+1,0,...lines); return L.join('\n');
}
const uniquePageName=base=>{ let n=base, i=2; while(S.ast.pages.some(p=>p.name===n)) n=`${base} (${i++})`; return n; };
/* A copy of the page in which each icon shape also carries its picture, so importing the .vsdx again keeps the icon */
function withIconData(doc){
  if(!S.ast.icons.size) return doc;
  const copy=doc.cloneNode(true);
  for(const el of copy.getElementsByTagNameNS(NS,'Shape')){ const d=S.ast.icons.get(userV(el,'FlowIcon')); if(d) setUser(el,'FlowIconData',d); }
  return copy;
}
function vsdxFiles(){
  const V=`xmlns="${NS}" xmlns:r="${RNS}" xml:space="preserve"`, b=blankFiles(), files={};
  for(const k of ['_rels/.rels','docProps/core.xml','docProps/app.xml','visio/document.xml','visio/_rels/document.xml.rels']) files[k]=b[k];
  const pg=(w,h)=>`<Cell N="PageWidth" V="${w}" U="MM"/><Cell N="PageHeight" V="${h}" U="MM"/><Cell N="PageScale" V="${MM}" U="MM"/><Cell N="DrawingScale" V="${MM}" U="MM"/><Cell N="DrawingSizeType" V="0"/><Cell N="DrawingScaleType" V="0"/><Cell N="PrintPageOrientation" V="${w>h?2:1}"/>`;
  files['[Content_Types].xml']=XML_DECL+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>'
    +S.pages.map((_,i)=>`<Override PartName="/visio/pages/page${i+1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`).join('')
    +'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  files['visio/pages/pages.xml']=XML_DECL+`<Pages ${V}>`+S.pages.map((p,i)=>`<Page ID="${i}" NameU="${xmlEsc(p.name)}" Name="${xmlEsc(p.name)}" ViewScale="-1"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0">${pg(p.w,p.h)}</PageSheet><Rel r:id="rId${i+1}"/></Page>`).join('')+'</Pages>';
  files['visio/pages/_rels/pages.xml.rels']=XML_DECL+`<Relationships xmlns="${PRNS}">`+S.pages.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${i+1}.xml"/>`).join('')+'</Relationships>';
  S.pages.forEach((p,i)=>files[`visio/pages/page${i+1}.xml`]=XML_DECL+ser(withIconData(p.doc)));
  return files;
}
export async function buildVsdx(){
  if(!window.JSZip) throw new Error('the zip library did not load, so Visio files cannot be made. Check the internet connection and reload.');
  const zip=new JSZip(), f=vsdxFiles(); for(const k in f) zip.file(k,f[k]);
  return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.ms-visio.drawing'});
}
export function visioNotes(){
  const used=new Set(); for(const ap of S.ast.pages) for(const e of ap.edges) for(const m of [e.start,e.end]) if(!VISIO_CONFIRMED.has(m)) used.add(MARKERS[m].toLowerCase());
  return used.size?[`In Visio, these line ends show as a plain arrow or no end until Visio's arrowhead numbers are confirmed: ${[...used].join(', ')}. They are correct in this editor, draw.io and DOT.`]:[];
}

/* ---------- opening and saving ---------- */
const OPEN_TYPES=[{description:'Diagrams',accept:{'text/plain':['.flow','.mmd','.mermaid','.puml','.plantuml','.pu','.dot','.gv','.drawio','.md','.txt']}}];
const SAVE_TYPES=[{description:'Flow diagram',accept:{'text/plain':['.flow']}}];
export const isFlowText=t=>/^\s*(?:#[^\n]*\n\s*)*(?:flow\s+\d|page\s+")/i.test(t);
export async function openAny(file,handle){
  const name=file.name, lower=name.toLowerCase();
  try{
    if(/\.vsd[xm]$/.test(lower)){ openImport(file); return; }   // Visio drawings are imported into the document, not opened
    if(/\.vsd$/.test(lower)) throw new Error('older .vsd files need to be opened in Visio and saved as .vsdx first.');
    if(file.size>MAX_IMPORT_CHARS) throw new Error('the file is too large.');
    const text=await file.text();
    if(lower.endsWith('.flow')||isFlowText(text)){ loadText(text,name.endsWith('.flow')?name:name+'.flow',lower.endsWith('.flow')?handle:null); toast('Opened '+name+'.'); return; }
    const body=unfence(text), fmt=detectFormat(body);
    if(!fmt) throw new Error('the format was not recognised.');
    const g=applyTags(await IMPORTERS[fmt](body)); layoutGraph(g);
    const {lines}=graphStatements(g);
    loadText(['flow 1','',pageStmt({name:'Page-1',direction:g.direction}),...lines,''].join('\n'),name.replace(/\.[^.]+$/,'')+'.flow',null);
    toast(`Opened ${name} as a new flow document.`+(g.warnings.length?' '+g.warnings.join(' '):''),g.warnings.length?9000:4500);
  }catch(e){ console.error('Could not open',name,e); toast('Could not open '+name+': '+e.message,8000); }
}
export async function openFile(){
  if(S.dirty&&!confirm('Discard unsaved changes?')) return;
  if(window.showOpenFilePicker){
    try{ const [h]=await window.showOpenFilePicker({types:OPEN_TYPES}); await openAny(await h.getFile(),h); return; }
    catch(e){ if(e.name==='AbortError') return; console.warn('File picker unavailable here, using the file input instead',e); }
  }
  $('fileInput').click();
}
export async function save(as){
  if(S.editing) commitText();
  if(TP.open&&TP.mode==='flow') applyFromEditor(true);
  const blob=new Blob([S.text.endsWith('\n')?S.text:S.text+'\n'],{type:'text/plain'});
  const done=()=>{ setDirty(false); toast('Saved '+S.name+'.'); };
  if(!/\.flow$/i.test(S.name)) S.name=S.name.replace(/\.[^.]+$/,'')+'.flow';
  try{
    if(!as&&S.handle&&S.handle.createWritable){ const w=await S.handle.createWritable(); await w.write(blob); await w.close(); done(); return; }
    if(window.showSaveFilePicker){ const h=await window.showSaveFilePicker({suggestedName:S.name,types:SAVE_TYPES});
      const w=await h.createWritable(); await w.write(blob); await w.close(); S.handle=h; S.name=h.name; done(); return; }
  }catch(e){ if(e.name==='AbortError') return; console.error('Saving through the file picker failed; downloading instead',e); }
  downloadBlob(blob,S.name); done();
}
export function addPage(){ const name=nextPageName('Page'); editDoc(S.text.replace(/\s*$/,'\n')+'\n'+pageStmt({name})+'\n',S.ast.pages.length); }
