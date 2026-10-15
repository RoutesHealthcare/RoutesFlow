/* =====================================================================
   Dialogs
   ===================================================================== */
import {$, S, kid, kids, toast} from './core.js';
import {pageCtx} from './render.js';
import {commitText} from './text-editor.js';
import {downloadBlob} from './properties.js';
import {EXPORTERS, FMT, MAX_IMPORT_CHARS, pageGraph, plural} from './formats/export.js';
import {IMPORTERS, detectFormat, isActivityText, unfence} from './formats/import.js';
import {buildVsdx, importGraph, importVisio, isFlowText, visioNotes} from './visio-io.js';

const baseName=()=>S.name.replace(/\.[^.]+$/,'')||'diagram';
function setNote(id,msg,isError){ const n=$(id); n.textContent=msg; n.classList.toggle('error',!!isError); }
function refreshExport(){
  const fmt=$('exportFmt').value, f=FMT[fmt];
  $('exportCopy').disabled=!!f.binary; $('exportText').hidden=!!f.binary;
  if(f.binary){ $('exportText').value=''; setNote('exportNotes',['A Visio drawing is a binary file, so there is nothing to preview. Use Download to save it.',...visioNotes()].join('\n')); return; }
  try{
    const g=pageGraph(); $('exportText').value=EXPORTERS[fmt](g);
    const notes=fmt==='drawio'?[]:['Shapes, labels and arrows are kept. Positions, sizes and colours are not.'];
    setNote('exportNotes',[...notes,...g.warnings].join('\n'));
  }catch(e){ console.error('Export failed',e); $('exportText').value=''; setNote('exportNotes','Could not export: '+e.message,true); }
}
function openExport(){ if(S.editing) commitText(); $('exportDlg').showModal(); refreshExport(); }
async function copyExport(){
  const t=$('exportText').value; if(!t) return;
  try{ await navigator.clipboard.writeText(t); toast('Copied to the clipboard.'); }
  catch(e){ console.warn('Clipboard write was refused',e); $('exportText').select(); toast('Copying was blocked here. The text is selected: press Ctrl+C to copy it.',6000); }
}
async function downloadExport(){
  const f=FMT[$('exportFmt').value], t=$('exportText').value;
  if(f.binary){ try{ downloadBlob(await buildVsdx(),baseName()+'.'+f.ext); }catch(e){ console.error('Visio export failed',e); setNote('exportNotes','Could not make the Visio file: '+e.message,true); } return; }
  if(!t) return;
  downloadBlob(new Blob([t],{type:f.mime}),baseName()+(f.suffix||'')+'.'+f.ext);
}
const MAX_VISIO_BYTES=50e6;
const isVisioName=n=>/\.vsd[xm]$/i.test(n);
let visioFile=null;   // a .vsdx waiting to be imported; it replaces the text box until the dialog closes
function setVisio(f){
  visioFile=f; $('importText').disabled=$('importFmt').disabled=!!f;
  if(f){ $('importText').value=''; setNote('importNotes',`Visio drawing ${f.name} is ready. Choose where to put it, then press Import.`); }
}
/* file: optional .vsdx to import, for a Visio drawing that was opened or dropped on the page */
export function openImport(file){
  if(S.editing) commitText(); setNote('importNotes',''); setVisio(null);
  if(file&&file.name){ if(file.size>MAX_VISIO_BYTES){ toast('That Visio file is too large to import.'); return; } setVisio(file); }
  $('importDlg').showModal(); (file?$('importGo'):$('importText')).focus();
}
async function runVisioImport(){
  const dest=$('importDest').value, btn=$('importGo');
  if(dest==='replace'&&kids(kid(pageCtx().doc.documentElement,'Shapes'),'Shape').length&&!confirm('Replace everything on this page? Undo will bring it back.')) return;
  btn.disabled=true;
  try{ await importVisio(await visioFile.arrayBuffer(),visioFile.name,dest); $('importDlg').close(); }
  catch(e){ console.error('Visio import failed',e); setNote('importNotes','Could not import: '+e.message,true); }
  finally{ btn.disabled=false; }
}
async function runImport(){
  if(visioFile) return runVisioImport();
  let text=$('importText').value;
  if(!text.trim()){ setNote('importNotes','Paste some text or choose a file first.',true); return; }
  if(text.length>MAX_IMPORT_CHARS){ setNote('importNotes','That text is too large to import.',true); return; }
  const btn=$('importGo'); btn.disabled=true;
  try{
    text=unfence(text);
    if(isFlowText(text)) throw new Error('this is a flow document. Open it with Open instead.');
    const fmt=$('importFmt').value==='auto'?detectFormat(text):$('importFmt').value;
    if(!fmt) throw new Error('the format was not recognised. Choose it from the Format list.');
    const g=await IMPORTERS[fmt](text), dest=$('importDest').value;
    if(dest==='replace'&&kids(kid(pageCtx().doc.documentElement,'Shapes'),'Shape').length&&!confirm('Replace everything on this page? Undo will bring it back.')) return;
    await importGraph(g,dest);
    $('importDlg').close();
    const used=fmt==='plantuml'?(isActivityText(text)?FMT.activity.name:FMT.plantuml.name):FMT[fmt].name;
    toast(`Imported ${plural(g.nodes.length,'shape')} and ${plural(g.edges.length,'connection')} from ${used}.`+(g.warnings.length?' '+g.warnings.join(' '):''),g.warnings.length?10000:4500);
  }catch(e){ console.error('Import failed',e); setNote('importNotes','Could not import: '+e.message,true); }
  finally{ btn.disabled=false; }
}

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  for(const [k,f] of Object.entries(FMT)) $('exportFmt').appendChild(new Option(f.name,k));
  for(const [k,f] of Object.entries(FMT)) if(!f.binary) $('importFmt').appendChild(new Option(k==='plantuml'?'PlantUML (either style)':f.name,k));
  $('exportFmt').onchange=refreshExport;
  $('exportCopy').onclick=copyExport; $('exportDownload').onclick=downloadExport; $('exportClose').onclick=()=>$('exportDlg').close();
  $('importFile').onclick=()=>$('importInput').click();
  $('importInput').addEventListener('change',async e=>{
    const f=e.target.files[0]; e.target.value=''; if(!f) return;
    if(/\.vsd$/i.test(f.name)){ setNote('importNotes','Older .vsd files need to be opened in Visio and saved as .vsdx first.',true); return; }
    if(isVisioName(f.name)){ if(f.size>MAX_VISIO_BYTES) setNote('importNotes','That Visio file is too large to import.',true); else setVisio(f); return; }
    setVisio(null);
    if(f.size>MAX_IMPORT_CHARS){ setNote('importNotes','That file is too large to import.',true); return; }
    try{ $('importText').value=await f.text(); setNote('importNotes',`Loaded ${f.name}.`); }
    catch(err){ console.error('Could not read file',err); setNote('importNotes','Could not read that file: '+err.message,true); }
  });
  $('importCancel').onclick=()=>$('importDlg').close();
  $('importDlg').addEventListener('close',()=>setVisio(null));
  $('importGo').onclick=runImport;
  $('btnImport').onclick=()=>openImport(); $('btnExport').onclick=openExport;
}
