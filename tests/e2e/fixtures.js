import {test as base, expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require=createRequire(import.meta.url);
/* Served in place of the CDN copy so the tests run offline and Visio export works */
const JSZIP=require.resolve('jszip/dist/jszip.min.js');
export const EXAMPLE=resolve('tests/fixtures/connection-types.flow');
/* An anonymised real-world Visio flowchart: dynamic connectors, icon masters, a line that ends on another line */
export const VISIO=resolve('tests/fixtures/visio-flowchart.vsdx');

/* Drives the editor through its UI only, so the same tests run against the source and the bundle */
export class FlowApp{
  constructor(page){ this.page=page; }
  get shapes(){ return this.page.locator('#layer > [data-id]'); }
  /* A top-level shape whose text is exactly `text` */
  shape(text){ return this.shapes.filter({has:this.page.locator('tspan',{hasText:new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`)})}); }
  async open(file=EXAMPLE){ await this.page.setInputFiles('#fileInput',file); await expect(this.shapes.first()).toBeVisible(); }
  /* Imports a file through the Import dialog; dest is new, replace or add */
  async importFile(file,dest='replace'){
    await this.page.click('#btnImport'); await this.page.setInputFiles('#importInput',file);
    await this.page.selectOption('#importDest',dest); await this.page.click('#importGo');
    await expect(this.page.locator('#importDlg')).toBeHidden();
  }
  /* Every connection's line as a list of [x,y] points */
  async connectionLines(){
    return this.page.locator('#layer > [data-id] > path[fill="none"][stroke="transparent"]').evaluateAll(ps=>ps.map(p=>
      [...p.getAttribute('d').matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map(m=>[+m[1],+m[2]])));
  }
  async centreOf(locator){ const b=await locator.boundingBox(); if(!b) throw new Error('not visible'); return {x:b.x+b.width/2,y:b.y+b.height/2}; }
  async click(text,{modifiers=[]}={}){
    const c=await this.centreOf(this.shape(text));
    for(const m of modifiers) await this.page.keyboard.down(m);
    await this.page.mouse.click(c.x,c.y);
    for(const m of modifiers.reverse()) await this.page.keyboard.up(m);
  }
  async drag(from,to,{steps=6}={}){ const m=this.page.mouse; await m.move(from.x,from.y); await m.down(); await m.move(to.x,to.y,{steps}); await m.up(); }
  /* Screen position halfway along the line of the connection labelled `label` */
  async connectionPoint(label){
    return this.shape(label).locator(':scope > path[fill="none"][stroke="transparent"]').evaluate(p=>{
      const pt=p.getPointAtLength(p.getTotalLength()/2), m=p.getScreenCTM(); return {x:pt.x*m.a+pt.y*m.c+m.e,y:pt.x*m.b+pt.y*m.d+m.f}; });
  }
  get title(){ return this.page.locator('#selTitle'); }
  /* one per selected item: an outline round a shape, or a highlight along a line */
  get selectionBoxes(){ return this.page.locator('#overlay .selbox, #overlay .selline'); }
  get textEditor(){ return this.page.locator('#textEditor'); }
  async nothingSelected(){ await expect(this.page.locator('#propsShape')).toBeHidden(); }
  /* The diagram as .flow text, from the text pane */
  async flowText(){ await this.page.keyboard.press('Control+e'); const t=await this.page.locator('#codeText').inputValue(); await this.page.keyboard.press('Control+e'); return t; }
}

export const test=base.extend({
  appUrl:['',{option:true}],
  /* false makes the page behave like a first visit, so the guided tour opens by itself */
  tourSeen:[true,{option:true}],
  app:async({page,appUrl,tourSeen},use)=>{
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/jszip.min.js',r=>r.fulfill({path:JSZIP,contentType:'text/javascript'}));
    if(tourSeen) await page.addInitScript(()=>{ try{ localStorage.setItem('flowEditor.tourSeen','1'); }catch(_){} });
    await page.goto(appUrl);
    await expect(page.locator('#canvas')).toBeVisible();
    await use(new FlowApp(page));
    expect(errors,'uncaught errors in the page').toEqual([]);
  },
});
export {expect};
