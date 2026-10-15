/* ---------- package reading ---------- */
import {NS, PRNS, RNS, S, XML_DECL, kid, kids, ownCell, parseXml} from './core.js';

function resolvePath(base,target){
  if(target.startsWith('/')) return target.slice(1);
  const out=[]; for(const p of (base+target).split('/')){ if(p==='..') out.pop(); else if(p&&p!=='.') out.push(p); }
  return out.join('/');
}
function relsPathFor(part){ const i=part.lastIndexOf('/'); return part.slice(0,i+1)+'_rels/'+part.slice(i+1)+'.rels'; }
async function readXml(path){ const f=S.zip.file(path); if(!f) return null; return parseXml(await f.async('string')); }
async function readRels(part){
  const d=await readXml(relsPathFor(part)); const m={}; if(!d) return m;
  const base=part.slice(0,part.lastIndexOf('/')+1);
  for(const r of d.getElementsByTagNameNS(PRNS,'Relationship')){
    if(r.getAttribute('TargetMode')==='External') continue;
    m[r.getAttribute('Id')]={target:resolvePath(base,r.getAttribute('Target')),type:r.getAttribute('Type')};
  }
  return m;
}
const relOf=(rels,suffix)=>(Object.values(rels).find(r=>r.type&&r.type.endsWith(suffix))||{}).target;

export async function parsePackage(){
  const rootRels=await readRels('');
  const docPart=relOf(rootRels,'/document')||'visio/document.xml';
  const docRels=await readRels(docPart);
  const pagesPart=relOf(docRels,'/pages'), mastersPart=relOf(docRels,'/masters');
  if(!pagesPart) throw new Error('no pages were found in the package');

  S.styles={};
  const dd=await readXml(docPart);
  if(dd) for(const st of kids(kid(dd.documentElement,'StyleSheets'),'StyleSheet')) S.styles[st.getAttribute('ID')]=st;

  S.masters={};
  if(mastersPart){
    const md=await readXml(mastersPart), mr=await readRels(mastersPart);
    if(md) for(const m of kids(md.documentElement,'Master')){
      const rel=kid(m,'Rel'), t=rel&&mr[rel.getAttributeNS(RNS,'id')]; if(!t) continue;
      const d=await readXml(t.target); if(!d) continue;
      const byId={}; for(const s of d.getElementsByTagNameNS(NS,'Shape')) byId[s.getAttribute('ID')]=s;
      S.masters[m.getAttribute('ID')]={byId,top:kid(kid(d.documentElement,'Shapes'),'Shape'),name:m.getAttribute('NameU')||m.getAttribute('Name')||''};
    }
  }

  const pd=await readXml(pagesPart), pr=await readRels(pagesPart);
  S.pages=[]; S.pagesDoc=pd; S.pagesPart=pagesPart;
  for(const p of kids(pd.documentElement,'Page')){
    const rel=kid(p,'Rel'), t=rel&&pr[rel.getAttributeNS(RNS,'id')]; if(!t) continue;
    const doc=await readXml(t.target); if(!doc) continue;
    const ps=kid(p,'PageSheet');
    const gv=(n,d)=>{ const c=ownCell(ps,n); const v=c?parseFloat(c.getAttribute('V')):NaN; return isFinite(v)?v:d; };
    S.pages.push({name:p.getAttribute('Name')||p.getAttribute('NameU')||'Page',path:t.target,doc,
      w:gv('PageWidth',8.5),h:gv('PageHeight',11),bg:p.getAttribute('Background')==='1',sheet:ps});
  }
  if(!S.pages.length) throw new Error('no readable pages were found');
}

/* ---------- new blank document (A4 landscape, metric) ---------- */
export function blankFiles(){
  const V=`xmlns="${NS}" xmlns:r="${RNS}" xml:space="preserve"`;
  const now=new Date().toISOString().replace(/\.\d+Z$/,'Z');
  const pg=(w,h)=>`<Cell N="PageWidth" V="${w}" U="MM"/><Cell N="PageHeight" V="${h}" U="MM"/><Cell N="ShdwOffsetX" V="0.1181102362204724" U="MM"/><Cell N="ShdwOffsetY" V="-0.1181102362204724" U="MM"/><Cell N="PageScale" V="0.03937007874015748" U="MM"/><Cell N="DrawingScale" V="0.03937007874015748" U="MM"/><Cell N="DrawingSizeType" V="0"/><Cell N="DrawingScaleType" V="0"/><Cell N="InhibitSnap" V="0"/><Cell N="UIVisibility" V="0"/><Cell N="PrintPageOrientation" V="2"/>`;
  return {
    '[Content_Types].xml':XML_DECL+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/><Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
    '_rels/.rels':XML_DECL+`<Relationships xmlns="${PRNS}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/core.xml':XML_DECL+`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Flow diagram</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml':XML_DECL+'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Visio</Application><AppVersion>16.0000</AppVersion></Properties>',
    'visio/document.xml':XML_DECL+`<VisioDocument ${V}><DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0"><GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions><DynamicGridEnabled>1</DynamicGridEnabled><ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes><ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds></DocumentSettings><StyleSheets><StyleSheet ID="0" NameU="No Style" IsCustomNameU="1" Name="No Style" IsCustomName="1"><Cell N="EnableLineProps" V="1"/><Cell N="EnableFillProps" V="1"/><Cell N="EnableTextProps" V="1"/><Cell N="HideForApply" V="0"/><Cell N="LineWeight" V="0.01041666666666667" U="PT"/><Cell N="LineColor" V="0"/><Cell N="LinePattern" V="1"/><Cell N="Rounding" V="0"/><Cell N="EndArrowSize" V="2"/><Cell N="BeginArrow" V="0"/><Cell N="EndArrow" V="0"/><Cell N="LineCap" V="0"/><Cell N="BeginArrowSize" V="2"/><Cell N="LineColorTrans" V="0"/><Cell N="FillForegnd" V="1"/><Cell N="FillBkgnd" V="0"/><Cell N="FillPattern" V="1"/><Cell N="ShdwForegnd" V="0"/><Cell N="ShdwPattern" V="0"/><Cell N="FillForegndTrans" V="0"/><Cell N="FillBkgndTrans" V="0"/><Cell N="LeftMargin" V="0.05555555555555555" U="PT"/><Cell N="RightMargin" V="0.05555555555555555" U="PT"/><Cell N="TopMargin" V="0.05555555555555555" U="PT"/><Cell N="BottomMargin" V="0.05555555555555555" U="PT"/><Cell N="VerticalAlign" V="1"/><Cell N="TextBkgnd" V="0"/><Section N="Character"><Row IX="0"><Cell N="Color" V="0"/><Cell N="Style" V="0"/><Cell N="Case" V="0"/><Cell N="Pos" V="0"/><Cell N="FontScale" V="1"/><Cell N="Size" V="0.1666666666666667" U="PT"/></Row></Section><Section N="Paragraph"><Row IX="0"><Cell N="HorzAlign" V="1"/></Row></Section></StyleSheet></StyleSheets></VisioDocument>`,
    'visio/_rels/document.xml.rels':XML_DECL+`<Relationships xmlns="${PRNS}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/></Relationships>`,
    'visio/pages/pages.xml':XML_DECL+`<Pages ${V}><Page ID="0" NameU="Page-1" Name="Page-1" ViewScale="-1" ViewCenterX="5.845" ViewCenterY="4.135"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0">${pg(11.69291338582677,8.267716535433071)}</PageSheet><Rel r:id="rId1"/></Page></Pages>`,
    'visio/pages/_rels/pages.xml.rels':XML_DECL+`<Relationships xmlns="${PRNS}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/></Relationships>`,
    'visio/pages/page1.xml':XML_DECL+`<PageContents ${V}/>`
  };
}
/* ---------- inheritance: shape -> master -> style ---------- */
export function shapeCtx(el,inheritMid){
  const m=el.getAttribute('Master'), mid=m||inheritMid||null, ms=mid&&S.masters[mid];
  let mel=null;
  if(ms){ const msId=el.getAttribute('MasterShape'); mel=msId?(ms.byId[msId]||null):(m?ms.top:null); }
  return {el,mid,mel};
}
function styleCell(sh,n){
  const kind=/^(Fill|Shdw)/.test(n)?'FillStyle':/^(Line|BeginArrow|EndArrow|Rounding)/.test(n)?'LineStyle':'TextStyle';
  let sid=sh.el.getAttribute(kind)??(sh.mel?sh.mel.getAttribute(kind):null);
  for(let i=0;i<8&&sid!=null;i++){ const st=S.styles[sid]; if(!st) break; const c=ownCell(st,n); if(c) return c; sid=st.getAttribute(kind); }
  return null;
}
function findCell(sh,n){ return ownCell(sh.el,n)||ownCell(sh.mel,n)||styleCell(sh,n); }
export function cellV(sh,n,d){ const c=findCell(sh,n); if(!c) return d; const v=c.getAttribute('V'); return v==null?d:v; }
export function num(sh,n,d){ const v=parseFloat(cellV(sh,n,null)); return isFinite(v)?v:d; }
export const numEl=(el,n,d)=>{ const c=ownCell(el,n); const v=c?parseFloat(c.getAttribute('V')):NaN; return isFinite(v)?v:d; };
export function rowCellEl(el,sec,ix,n){
  if(!el) return null;
  for(const s of kids(el,'Section')) if(s.getAttribute('N')===sec) for(const r of kids(s,'Row')) if((r.getAttribute('IX')||'0')===ix){ const c=ownCell(r,n); if(c) return c; }
  return null;
}
export function rowV(sh,sec,ix,n){
  let c=rowCellEl(sh.el,sec,ix,n)||rowCellEl(sh.mel,sec,ix,n);
  let sid=sh.el.getAttribute('TextStyle')??(sh.mel?sh.mel.getAttribute('TextStyle'):null);
  for(let i=0;!c&&i<8&&sid!=null;i++){ const st=S.styles[sid]; if(!st) break; c=rowCellEl(st,sec,ix,n); sid=st.getAttribute('TextStyle'); }
  return c?c.getAttribute('V'):null;
}
export const is1D=sh=>cellV(sh,'BeginX',null)!=null;
export function shapeText(sh){ const t=kid(sh.el,'Text')||kid(sh.mel,'Text'); return t?t.textContent.replace(/\r/g,'').replace(/\n+$/,''):''; }
export function setText(el,txt){
  let t=kid(el,'Text');
  if(!t){ t=el.ownerDocument.createElementNS(NS,'Text'); el.insertBefore(t,[...el.children].find(x=>['Data1','Data2','Data3','ForeignData','Shapes'].includes(x.localName))||null); }
  while(t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(el.ownerDocument.createTextNode(txt));
}
