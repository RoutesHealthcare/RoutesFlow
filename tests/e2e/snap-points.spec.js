import {test, expect} from './fixtures.js';

test.beforeEach(async({app})=>{ await app.open(); });

/* Screen point just inside a shape's cardinal snap point: 'n','e','s' or 'w'. Reads the shape group's own
   getBoundingClientRect() rather than Playwright's locator.boundingBox(), which (for a filtered locator
   matching on a descendant tspan) was observed to report a box inflated well beyond the real shape rect. */
async function snapPoint(locator,side){
  const r=await locator.evaluate(g=>g.getBoundingClientRect()), in_=3;
  const mid={x:r.x+r.width/2,y:r.y+r.height/2};
  return {n:{x:mid.x,y:r.y+in_},s:{x:mid.x,y:r.y+r.height-in_},e:{x:r.x+r.width-in_,y:mid.y},w:{x:r.x+in_,y:mid.y}}[side];
}

test('dragging a connection end onto a shape\'s snap point sticks there, and stays put when the shape moves', async({app,page})=>{
  const p=await app.connectionPoint('next');
  await page.mouse.click(p.x,p.y+3);
  await expect(app.title).toHaveText('Connection');
  const endHandle=page.locator('[data-handle="end"]');
  const target=await snapPoint(app.shape('Step B'),'n');
  await app.drag(await app.centreOf(endHandle),target);
  expect(await app.flowText()).toMatch(/a1 -> a2 \[[^\]]*endpt=n[^\]]*\]/);

  // moving the shape the line is glued to should not recentre the end away from its snap point
  const before=await app.shape('Step B').evaluate(g=>g.getBoundingClientRect());
  const mid={x:before.x+before.width/2,y:before.y+before.height/2};
  await app.drag(mid,{x:mid.x+80,y:mid.y+60});
  const after=await app.shape('Step B').evaluate(g=>g.getBoundingClientRect());

  // re-select the (now re-routed) line and read its end handle, both in screen space like `after`
  const p2=await app.connectionPoint('next');
  await page.mouse.click(p2.x,p2.y+3);
  await expect(app.title).toHaveText('Connection');
  const endPt=await app.centreOf(page.locator('[data-handle="end"]'));
  expect(Math.abs(endPt.y-after.y)).toBeLessThan(6);
  expect(endPt.x).toBeGreaterThan(after.x);
  expect(endPt.x).toBeLessThan(after.x+after.width);
});

test('drawing a new connection in connect mode can start and end on a specific snap point', async({app,page})=>{
  await page.click('#toolConnect');
  const from=await snapPoint(app.shape('Care worker'),'e');   // c1: not yet connected to d2
  const to=await snapPoint(app.shape('On-call'),'w');
  await app.drag(from,to);
  expect(await app.flowText()).toMatch(/c1\s+\S+\s+d2\s*\[[^\]]*beginpt=e[^\]]*endpt=w[^\]]*\]/);
});

test('a snap point survives switching the connection to right-angled routing, and holds after the shape moves', async({app,page})=>{
  await page.click('#toolConnect');
  const from=await snapPoint(app.shape('Care worker'),'e');
  const to=await snapPoint(app.shape('On-call'),'w');
  await app.drag(from,to);
  await page.click('#toolConnect');   // back to select mode

  // label the new connection so it can be found again by text after the shape moves, same as the
  // fixture's pre-existing "next" connection
  const mid={x:(from.x+to.x)/2,y:(from.y+to.y)/2};
  await page.mouse.dblclick(mid.x,mid.y);
  await page.keyboard.type('snaptest');
  await page.keyboard.press('Control+Enter');

  await expect(app.title).toHaveText('Connection');
  await page.locator('#pRoute').selectOption('elbow');
  expect(await app.flowText()).toMatch(/c1\s+\S+\s+d2\s*\[[^\]]*route=elbow[^\]]*beginpt=e[^\]]*endpt=w[^\]]*\]\s*:\s*"snaptest"/);

  // move "On-call" and confirm the elbow-routed line still lands on its west edge, not recentred
  const rect=()=>app.shape('On-call').evaluate(g=>g.getBoundingClientRect());
  const before=await rect(), bmid={x:before.x+before.width/2,y:before.y+before.height/2};
  await app.drag(bmid,{x:bmid.x+100,y:bmid.y-60});
  const after=await rect();

  const p2=await app.connectionPoint('snaptest');
  await page.mouse.click(p2.x,p2.y);
  await expect(app.title).toHaveText('Connection');
  const endPt=await app.centreOf(page.locator('[data-handle="end"]'));
  expect(Math.abs(endPt.x-after.x)).toBeLessThan(6);
  expect(endPt.y).toBeGreaterThan(after.y-1);
  expect(endPt.y).toBeLessThan(after.y+after.height+1);
});
