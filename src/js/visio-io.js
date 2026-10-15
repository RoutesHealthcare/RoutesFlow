/* ---------- graph model to statements (imports and Visio) ---------- */
import {$, DEF, MM, NS, PRNS, RNS, S, XML_DECL, kid, kids, ser, toast} from './core.js';
import {blankFiles, is1D, parsePackage, shapeCtx} from './visio-package.js';
import {SHAPES, roleOf} from './shapes.js';
import {commitText} from './text-editor.js';
import {downloadBlob} from './properties.js';
import {MAX_IMPORT_CHARS, pageGraph, plural, xmlEsc} from './formats/export.js';
import {IMPORTERS, detectFormat, unfence} from './formats/import.js';
import {layoutGraph} from './layout.js';
import {MARKERS, VISIO_CONFIRMED, applyTags, userV} from './flow/model.js';
import {FLOW_ID, FLOW_KINDS, autoSizeMM, edgeStmt, keyStmt, pageStmt, shapeStmt, tableH, uniqueFid} from './flow/language.js';
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
      stroke:hex(n.line)&&hex(n.line)!==DEF.line.toUpperCase()?hex(n.line):null,text:hex(n.textColour)&&hex(n.textColour)!==(T.textColour||DEF.text).toUpperCase()?hex(n.textColour):null});
    lines.push(shapeStmt({id:ids.get(n.id),kind,label:n.label||'',columns:kind==='table'?(n.columns&&n.columns.length?n.columns:['column']):null,place,attrs}));
  }
  for(const e of g.edges){
    const from=ids.get(e.from), to=ids.get(e.to); if(!from||!to||from===to) continue;
    lines.push(edgeStmt({from,to,style:e.style||'solid',start:e.start||'none',end:e.end||(e.directed===false?'none':'arrow'),means:e.means||'',stroke:e.stroke||null,weight:e.weight||null,label:e.label||''}));
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
async function openVisio(buf,name){
  let zip; try{ zip=await JSZip.loadAsync(buf); }catch(_){ throw new Error('that is not a .vsdx package. Open older .vsd files in Visio and save them as .vsdx first.'); }
  const keep={zip:S.zip,pages:S.pages,masters:S.masters,styles:S.styles,pi:S.pi};
  S.zip=zip;
  try{
    await parsePackage();
    const parts=['flow 1',''], used=new Set(); let redrawn=0;
    for(let i=0;i<S.pages.length;i++){
      S.pi=i; const pg=S.pages[i], g=pageGraph();
      redrawn+=kids(kid(pg.doc.documentElement,'Shapes'),'Shape').filter(el=>!is1D(shapeCtx(el,null))&&!roleOf(el)).length;
      parts.push(pageStmt({name:pg.name+(pg.bg?' (background)':''),size:[pg.w*25.4,pg.h*25.4]}));
      parts.push(...graphStatements(g,{ox:0,oy:0,used:new Set(),relabel:true}).lines);
      const key=kids(kid(pg.doc.documentElement,'Shapes'),'Shape').find(el=>roleOf(el)==='key');   // a key this editor wrote comes back as a key
      if(key){ const k=geoMM(key,pg); parts.push(keyStmt({title:userV(key,'FlowKeyTitle')||'Key',place:{x:k.x,y:k.y}})); }
      parts.push('');
    }
    S.zip=null;
    loadText(parts.join('\n'),name.replace(/\.vsd[xm]$/i,'')+'.flow',null);
    if(redrawn) toast(`Opened ${name}. ${plural(redrawn,'shape')} ${redrawn===1?'was':'were'} redrawn as the nearest editor shape; Visio-specific artwork and formatting are not kept.`,9000);
    else toast('Opened '+name+'.');
  }catch(e){ Object.assign(S,keep); throw e; }
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
  S.pages.forEach((p,i)=>files[`visio/pages/page${i+1}.xml`]=XML_DECL+ser(p.doc));
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
const OPEN_TYPES=[{description:'Diagrams',accept:{'text/plain':['.flow','.mmd','.mermaid','.puml','.plantuml','.pu','.dot','.gv','.drawio','.md','.txt'],'application/vnd.ms-visio.drawing':['.vsdx','.vsdm']}}];
const SAVE_TYPES=[{description:'Flow diagram',accept:{'text/plain':['.flow']}}];
export const isFlowText=t=>/^\s*(?:#[^\n]*\n\s*)*(?:flow\s+\d|page\s+")/i.test(t);
export async function openAny(file,handle){
  const name=file.name, lower=name.toLowerCase();
  try{
    if(/\.vsd[xm]$/.test(lower)){ await openVisio(await file.arrayBuffer(),name); return; }
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
