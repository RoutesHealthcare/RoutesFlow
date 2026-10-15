/* ---------- text editing ---------- */
import {$, S} from './core.js';
import {setText, shapeCtx, shapeText} from './visio-package.js';
import {isTable, roleOf, tableParts} from './shapes.js';
import {commit} from './document.js';

let ta;
function tableCellAt(el,pt){
  const {all,header}=tableParts(el);
  const hit=pt&&all.find(c=>{ const b=S.boxes[c.getAttribute('ID')]; return b&&pt.px>=b.x0&&pt.px<=b.x1&&pt.py>=b.y0&&pt.py<=b.y1; });
  return hit||header;
}
export function editText(id,initial,pt){
  if(roleOf(S.elById[id])==='key') return;   // the key is generated; change its title in the text
  if(isTable(S.elById[id])){ const cell=tableCellAt(S.elById[id],pt); if(!cell) return; id=cell.getAttribute('ID'); }
  const b=S.boxes[id], el=S.elById[id]; if(!b||!el) return;
  const w=Math.max(140,(b.x1-b.x0)*S.zoom), h=Math.max(44,(b.y1-b.y0)*S.zoom);
  const cx=(b.x0+b.x1)/2*S.zoom+S.panX, cy=(b.y0+b.y1)/2*S.zoom+S.panY;
  Object.assign(ta.style,{left:(cx-w/2)+'px',top:(cy-h/2)+'px',width:w+'px',height:h+'px'});
  ta.value=initial!=null?initial:shapeText(shapeCtx(el,null));
  ta.hidden=false; S.editing=id; ta.focus();
  if(initial!=null) ta.setSelectionRange(ta.value.length,ta.value.length); else ta.select();
}
export function commitText(cancel){
  const id=S.editing; if(!id) return; S.editing=null; ta.hidden=true;
  const el=S.elById[id]; if(!el||cancel) return;
  if(ta.value!==shapeText(shapeCtx(el,null))) commit(()=>setText(el,ta.value));
}

/* Wires this module to the page. main.js calls every init() once, in the order the original script ran. */
export function init(){
  ta=$('textEditor');
  ta.addEventListener('keydown',e=>{
    if(e.key==='Escape'){ e.preventDefault(); commitText(true); }
    else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); commitText(); }
    e.stopPropagation();
  });
  ta.addEventListener('blur',()=>commitText());
}
