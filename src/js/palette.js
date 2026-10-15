/* ---------- palette ---------- */
import {$, PX, S, stage, svg} from './core.js';
import {pageCtx} from './render.js';
import {SHAPES, addShape} from './shapes.js';
import {toPage} from './pointer.js';
import {commit} from './document.js';
import {openAny} from './visio-io.js';

export function setTool(t){ S.tool=t; $('toolConnect').setAttribute('aria-pressed',String(t==='connect')); stage.classList.toggle('connect',t==='connect'); }

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  $('toolConnect').onclick=()=>setTool(S.tool==='connect'?'select':'connect');
  for(const b of document.querySelectorAll('.palette [data-kind]')){
    b.onclick=()=>{
      const r=svg.getBoundingClientRect(), pg=pageCtx();
      const px=(r.width/2-S.panX)/S.zoom, py=(r.height/2-S.panY)/S.zoom;
      setTool('select'); commit(()=>{ S.sel=addShape(b.dataset.kind,px/PX,pg.h-py/PX); });
    };
    b.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/x-shape',b.dataset.kind); e.dataTransfer.effectAllowed='copy'; });
  }
  stage.addEventListener('dragover',e=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
  stage.addEventListener('drop',async e=>{
    e.preventDefault();
    const kind=e.dataTransfer.getData('text/x-shape');
    if(kind&&SHAPES[kind]){ const p=toPage(e); setTool('select'); commit(()=>{ S.sel=addShape(kind,p.x,p.y); }); return; }
    const f=e.dataTransfer.files&&e.dataTransfer.files[0];
    if(f){ if(S.dirty&&!confirm('Discard unsaved changes and open '+f.name+'?')) return; await openAny(f,null); }
  });
}
