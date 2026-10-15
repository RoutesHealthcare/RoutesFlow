/* Builds dist/flow-editor.html: one self-contained file (CSS and bundled JS inlined) that works when opened
   straight from disk. The modular source in src/ needs a web server, because browsers refuse ES modules over file://.

   npm run build           write dist/Routesflow-editor.html
   npm run serve           serve src/ at http://localhost:8000 for development (no build step needed) */
import {build} from 'esbuild';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, join, normalize, resolve, sep} from 'node:path';

const SRC=resolve('src'), OUT=resolve('dist/Routesflow-editor.html');
const CSS_LINK='<link rel="stylesheet" href="css/flow-editor.css">';
const JS_ENTRY='<script type="module" src="js/main.js"></script>';

/* Replaces exactly one occurrence, so a changed tag in index.html fails the build instead of shipping a broken page */
function replaceOnce(text,find,replacement){
  const at=text.indexOf(find);
  if(at<0||text.indexOf(find,at+1)>=0) throw new Error(`Expected exactly one ${find} in src/index.html`);
  return text.slice(0,at)+replacement+text.slice(at+find.length);
}

async function bundle(){
  const result=await build({entryPoints:[join(SRC,'js/main.js')],bundle:true,format:'iife',target:'es2022',
    write:false,legalComments:'inline',logLevel:'warning'});
  // a literal </script inside the code would end the inline script element early
  const js=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  const css=(await readFile(join(SRC,'css/flow-editor.css'),'utf8')).replace(/<\/style/gi,'<\\/style');
  let html=await readFile(join(SRC,'index.html'),'utf8');
  html=replaceOnce(html,CSS_LINK,`<style>\n${css}</style>`);
  html=replaceOnce(html,JS_ENTRY,`<script>\n${js}</script>`);
  await mkdir(resolve('dist'),{recursive:true});
  await writeFile(OUT,html);
  console.log(`Wrote ${OUT} (${Math.round(html.length/1024)} KB)`);
}

const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
function serve(port=8000){
  createServer(async(req,res)=>{
    const rel=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,'')||'index.html';
    const file=normalize(join(SRC,rel));
    if(!file.startsWith(SRC+sep)){ res.writeHead(403).end(); return; }   // no ../ outside src/
    try{ const body=await readFile(file); res.writeHead(200,{'Content-Type':TYPES[extname(file)]||'application/octet-stream'}).end(body); }
    catch(err){ if(err.code!=='ENOENT'&&err.code!=='EISDIR') console.error(req.url,err); res.writeHead(404).end('Not found'); }
  }).listen(port,'127.0.0.1',()=>console.log(`Serving src/ at http://localhost:${port}/`));
}

if(process.argv.includes('--serve')) serve(+process.env.PORT||8000);
else bundle().catch(err=>{ console.error(err.message||err); process.exit(1); });
