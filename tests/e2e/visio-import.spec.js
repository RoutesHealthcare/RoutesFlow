import {test, expect, VISIO} from './fixtures.js';

/* every segment runs across or down the page; the few-pixel arcs drawn where lines cross (line jumps) are ignored */
const JUMP_PX=8;
const rightAngled=line=>line.slice(1).every((p,i)=>{ const q=line[i];
  return Math.hypot(p[0]-q[0],p[1]-q[1])<JUMP_PX||Math.abs(p[0]-q[0])<0.5||Math.abs(p[1]-q[1])<0.5; });

test('a Visio file chosen with Open goes to the Import dialog', async({app,page})=>{
  await page.setInputFiles('#fileInput',VISIO);
  await expect(page.locator('#importDlg')).toBeVisible();
  await expect(page.locator('#importNotes')).toContainText('visio-flowchart.vsdx');
  await expect(page.locator('#importText')).toBeDisabled();
});

test('importing keeps shapes, page size and right-angled connector routes', async({app,page})=>{
  await app.importFile(VISIO,'replace');
  await expect(page.locator('#toast')).toContainText('Imported visio-flowchart.vsdx');
  await expect(page.locator('#toast')).not.toContainText('left out');   // every connector is attached, including one that ends on another line
  await expect(page.locator('#pageInfo')).toHaveText(/841 × 594 mm, 40 shapes/);
  const lines=await app.connectionLines();
  expect(lines.length).toBeGreaterThan(40);
  expect(lines.filter(l=>!rightAngled(l))).toEqual([]);
  expect(await app.flowText()).toMatch(/route=elbow via="/);
});

test('a Visio soft line break stays inside the label', async({app,page})=>{
  await app.importFile(VISIO,'replace');
  const shape=app.shapes.filter({has:page.locator('tspan',{hasText:/^Line one$/})});
  await expect(shape).toHaveCount(1);
  await expect(shape.locator('tspan',{hasText:/^Line two$/})).toHaveCount(1);
  expect(await app.flowText()).toContain('"Line one\\nLine two"');
});

test('moving an imported shape re-routes its connectors at right angles', async({app,page})=>{
  await app.importFile(VISIO,'replace');
  const step=app.shape('Step 1'), c=await app.centreOf(step);
  await app.drag(c,{x:c.x+90,y:c.y+60});
  expect((await app.connectionLines()).filter(l=>!rightAngled(l))).toEqual([]);
});

test('the route can be switched between straight and right-angled', async({app,page})=>{
  await app.importFile(VISIO,'replace');
  const before=(await app.flowText()).match(/route=elbow/g).length;
  const line=(await app.connectionLines()).find(l=>l.length>2);
  const m=await page.locator('#layer').evaluate(g=>{ const k=g.getScreenCTM(); return [k.a,k.b,k.c,k.d,k.e,k.f]; });
  const [x,y]=[(line[0][0]+line[1][0])/2,(line[0][1]+line[1][1])/2];
  await page.mouse.click(x*m[0]+y*m[2]+m[4],x*m[1]+y*m[3]+m[5]);
  await expect(app.title).toHaveText('Connection');
  await page.selectOption('#pRoute','straight');
  expect((await app.flowText()).match(/route=elbow/g).length).toBe(before-1);
});
