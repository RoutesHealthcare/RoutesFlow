/* ---------- guided tour ----------
   A short walkthrough that opens by itself on the first visit and can be replayed from the Tour button.
   A step either waits for the user to do something, checked whenever the drawing, the selection or the
   text editor changes, or simply has a Next button. The tour only reads editor state; it never edits it. */
import {S, $} from './core.js';
import {shapeCtx, shapeText} from './visio-package.js';
import {roleOf} from './shapes.js';
import {isConnector, topLevelIds} from './selection.js';

const SEEN_KEY='flowEditor.tourSeen';
const GAP=12;   // px between the card and the thing it points at

const shapeIds=()=>topLevelIds().filter(id=>!isConnector(id)&&roleOf(S.elById[id])!=='key');
const connectionCount=()=>topLevelIds().filter(isConnector).length;
const textsKey=()=>shapeIds().map(id=>shapeText(shapeCtx(S.elById[id],null))).sort().join('\u0000');
const countShapes=()=>({n:shapeIds().length});
const moreShapes=s=>shapeIds().length>s.n;

/* target: what to highlight and point the card at (null keeps the card in the corner of the page).
   start() records the state a step compares against; done(state) says the user has finished it. */
const STEPS=[
  {title:'Welcome',next:'Start',
    body:'This tour covers the basics: adding shapes, editing their text, connecting them and selecting several at once. It takes about a minute. You can end it at any time and replay it from the Tour button.'},
  {title:'Add a shape',target:'.palette [data-kind="process"]',start:countShapes,done:moreShapes,
    body:'Click Process in the shape list, or drag it onto the page.'},
  {title:'Edit its text',target:null,start:()=>({t:textsKey()}),done:s=>!S.editing&&textsKey()!==s.t,
    body:'Click the new shape to select it, then click it again (or press Enter, or just start typing) to edit its text. Type a name, then press Ctrl+Enter or click elsewhere to finish.'},
  {title:'Add another shape',target:'.palette [data-kind="decision"]',start:countShapes,done:moreShapes,
    body:'Drag a Decision from the list to an empty spot on the page. If you click it instead, it lands in the middle, so drag it aside.'},
  {title:'Connect them',target:'#toolConnect',start:()=>({n:connectionCount()}),done:s=>connectionCount()>s.n,
    body:'Turn on Connect, then drag from one shape to the other. The line stays attached when you move either shape.'},
  {title:'Select several',target:null,done:()=>S.selection.size>=2,
    body:'Press Esc, then drag a box around both shapes, starting on an empty part of the page. Shift+click also adds or removes single items.'},
  {title:'Work on the selection',target:'#props',next:'Next',
    body:'Everything selected moves together when you drag it or use the arrow keys. You can also change colours here, duplicate with Ctrl+D or delete. Ctrl+Z undoes any change.'},
  {title:'The diagram as text',target:'#textTab',next:'Next',
    body:'The Text tab shows the diagram as text. Change either the drawing or the text and the other follows.'},
  {title:'Save and share',target:'#btnSave',next:'Finish',
    body:'Save keeps the diagram as a .flow file. Export makes Visio, Mermaid, PlantUML, DOT or draw.io. Press Tour at the top to see this again.'},
];

let step=-1, state=null, highlighted=null, checkQueued=false, observer=null;

function markSeen(){ try{ localStorage.setItem(SEEN_KEY,'1'); }catch(_){ /* private browsing: the tour may show again next time */ } }
function seen(){ try{ return localStorage.getItem(SEEN_KEY)==='1'; }catch(_){ return false; } }

export function startTour(){
  markSeen();
  $('tour').hidden=false;
  observer.observe($('layer'),{childList:true});
  observer.observe($('overlay'),{childList:true});
  observer.observe($('textEditor'),{attributes:true,attributeFilter:['hidden']});
  show(0);
}
export function endTour(){
  if(step<0) return;
  step=-1; state=null; observer.disconnect(); highlight(null);
  $('tour').hidden=true;
}
/* Opens the tour on the first visit only; afterwards it is replayed from the Tour button */
export function maybeStartTour(){ if(!seen()) startTour(); }

function show(i){
  if(i>=STEPS.length){ endTour(); return; }
  step=i; const s=STEPS[i];
  state={...(s.start?s.start():{})};
  $('tourCount').textContent=`Step ${i+1} of ${STEPS.length}`;
  $('tourTitle').textContent=s.title; $('tourBody').textContent=s.body;
  $('tourStatus').textContent=s.done?'Waiting for you to do this…':'';
  $('tourNext').textContent=s.done?'Skip this step':s.next;
  $('tourNext').classList.toggle('primary',!s.done);
  highlight(s.target?document.querySelector(s.target):null);
  place();
  if(!s.done) $('tourNext').focus();   // waiting steps leave focus on the page so typing and Enter reach the editor
}
function highlight(el){
  if(highlighted) highlighted.classList.remove('tour-target');
  highlighted=el; if(el) el.classList.add('tour-target');
}
/* Beside the highlighted element where there is room, otherwise in the bottom-right corner of the page */
function place(){
  const card=$('tour'), W=card.offsetWidth, H=card.offsetHeight, vw=innerWidth, vh=innerHeight;
  let x, y;
  if(highlighted){
    const r=highlighted.getBoundingClientRect();
    if(r.right+GAP+W<=vw){ x=r.right+GAP; y=r.top; }
    else if(r.bottom+GAP+H<=vh){ x=r.left; y=r.bottom+GAP; }
    else { x=r.left-GAP-W; y=r.top; }
  } else { const r=$('stage').getBoundingClientRect(); x=r.right-W-16; y=r.bottom-H-16; }
  card.style.left=Math.max(8,Math.min(x,vw-W-8))+'px';
  card.style.top=Math.max(8,Math.min(y,vh-H-8))+'px';
}
/* Runs once per frame at most, after the editor has finished reacting to the same event */
function queueCheck(){
  if(checkQueued||step<0) return; checkQueued=true;
  requestAnimationFrame(()=>{ checkQueued=false; const s=STEPS[step];
    if(!s||!s.done) return;
    try{ if(s.done(state)) show(step+1); }
    catch(err){ console.warn('Tour step check failed; skipping the step',s.title,err); show(step+1); } });
}

export function init(){
  observer=new MutationObserver(queueCheck);
  for(const ev of ['pointerup','keyup','focusout']) document.addEventListener(ev,queueCheck);
  $('tourNext').onclick=()=>show(step+1);
  $('tourEnd').onclick=endTour;
  $('btnTour').onclick=()=>{ endTour(); startTour(); };
  window.addEventListener('resize',()=>{ if(step>=0) place(); });
}
