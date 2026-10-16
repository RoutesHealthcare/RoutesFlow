/* =====================================================================
   Raster export: PNG and PDF snapshots of the page(s) as drawn. Unlike the text formats in export.js, these carry
   no shapes or connections back out, only pixels. A PNG is made for every page (one file each, zipped together
   when there is more than one); a PDF holds every page in a single document.
   ===================================================================== */
import {$, PX, S, safeFileName} from '../core.js';
import {pageCtx, render} from '../render.js';

const SCALE=2;   // oversample so a PNG, or the image inside a PDF, stays sharp when zoomed in or printed

/* Every page's rendered SVG, captured synchronously: nothing awaits between switching the live document to a page
   and reading it, so the page in view on screen is restored before this function returns and is never visibly
   disturbed (the renderer's own page-scoped caches are rebuilt by the final render() call, same as the page
   that was open before). Sized to the page itself, not the (possibly larger) canvas: content shown past the
   page's own edge in the editor, in grey, is cropped out here, the same as it would be printed or exported. */
function allPagesSvg(){
  const keepPi=S.pi, out=[];
  try{
    for(let i=0;i<S.pages.length;i++){
      S.pi=i; render();
      const pg=pageCtx(), w=pg.pageW*PX, h=pg.pageH*PX;
      out.push({name:pg.name,w,h,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`+
        `<rect width="${w}" height="${h}" fill="#FFFFFF"/>${$('layer').innerHTML}</svg>`});
    }
  } finally { S.pi=keepPi; render(); }
  return out;
}
function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image(); img.onload=()=>resolve(img); img.onerror=()=>reject(new Error('a page could not be drawn as an image'));
    img.src=src;
  });
}
function canvasToBlob(canvas,type,quality){
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('the image could not be made')),type,quality));
}
async function pageCanvas(p){
  const img=await loadImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(p.svg));
  const canvas=document.createElement('canvas'); canvas.width=Math.round(p.w*SCALE); canvas.height=Math.round(p.h*SCALE);
  const ctx=canvas.getContext('2d'); ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas;
}

/* One PNG per page. A single-page drawing downloads as a PNG; more than one page comes back as a zip, since a
   download is one file. Returns {blob, ext}, ready to save. */
export async function buildPngExport(){
  const pages=allPagesSvg(), made=[];
  for(const p of pages) made.push({name:p.name,blob:await canvasToBlob(await pageCanvas(p),'image/png')});
  if(made.length===1) return {blob:made[0].blob,ext:'png'};
  if(!window.JSZip) throw new Error('the zip library did not load, so a zip of PNGs cannot be made. Check the internet connection and reload.');
  const zip=new JSZip(), used=new Set();
  for(const p of made){
    const base=safeFileName(p.name)||'page'; let name=base,k=2;
    while(used.has(name)) name=`${base}-${k++}`;
    used.add(name); zip.file(`${name}.png`,p.blob);
  }
  return {blob:await zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/zip'}),ext:'zip'};
}

/* Every page, in page order, in one PDF document. Returns a Blob. */
export async function buildPdf(){
  const pages=allPagesSvg(), images=[];
  for(const p of pages){
    const canvas=await pageCanvas(p), jpeg=await canvasToBlob(canvas,'image/jpeg',0.92);
    images.push({jpeg:new Uint8Array(await jpeg.arrayBuffer()),pxW:canvas.width,pxH:canvas.height,ptW:p.w*72/PX,ptH:p.h*72/PX});
  }
  return pdfFromJpegs(images);
}

/* ---------- a minimal multi-page PDF, each page one JPEG image ----------
   A PDF image XObject accepts JPEG bytes unchanged (the DCTDecode filter), so each page's picture is copied
   straight in; no PDF library is needed for a document of whole-page images. */
const fmtN=n=>(Math.round(n*100)/100).toString();
function pdfFromJpegs(images){
  const enc=new TextEncoder(), chunks=[], offsets=[0]; let len=0;
  const put=u8=>{ chunks.push(u8); len+=u8.length; };
  const text=s=>put(enc.encode(s));
  const obj=(n,head,body,tail)=>{ offsets[n]=len; text(head); if(body) put(body); if(tail!=null) text(tail); };
  // 1=Catalog, 2=Pages; each page then takes three objects: the page, its content stream and its image
  const nums=images.map((_,i)=>({page:3+i*3,content:4+i*3,image:5+i*3})), total=2+3*images.length;
  text('%PDF-1.4\n');
  obj(1,'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n');
  obj(2,`2 0 obj<</Type/Pages/Kids[${nums.map(n=>n.page+' 0 R').join(' ')}]/Count ${images.length}>>endobj\n`);
  images.forEach((im,i)=>{
    const {page,content,image}=nums[i];
    obj(page,`${page} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${fmtN(im.ptW)} ${fmtN(im.ptH)}]/Resources<</XObject<</Im0 ${image} 0 R>>>>/Contents ${content} 0 R>>endobj\n`);
    const stream=enc.encode(`q ${fmtN(im.ptW)} 0 0 ${fmtN(im.ptH)} 0 0 cm /Im0 Do Q`);
    obj(content,`${content} 0 obj<</Length ${stream.length}>>stream\n`,stream,'\nendstream endobj\n');
    obj(image,`${image} 0 obj<</Type/XObject/Subtype/Image/Width ${im.pxW}/Height ${im.pxH}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${im.jpeg.length}>>stream\n`,im.jpeg,'\nendstream endobj\n');
  });
  const xrefAt=len;
  text(`xref\n0 ${total+1}\n0000000000 65535 f \n`);
  for(let i=1;i<=total;i++) text(String(offsets[i]||0).padStart(10,'0')+' 00000 n \n');
  text(`trailer<</Size ${total+1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF`);
  return new Blob(chunks,{type:'application/pdf'});
}
