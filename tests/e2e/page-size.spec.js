import {test, expect} from './fixtures.js';

test.beforeEach(async({app})=>{ await app.open(); });

const setValue=(page,id,v)=>page.locator(id).evaluate((i,v)=>{ i.value=v; i.dispatchEvent(new Event('change')); },v);

test('setting width/height in the Page panel writes an explicit page size', async({app,page})=>{
  await app.nothingSelected();
  // comfortably bigger than the fixture's existing content, so the floor set here isn't immediately
  // overridden by auto-grow (which always wins the larger of the two — see the test below)
  await setValue(page,'#pPageW','900'); await setValue(page,'#pPageH','700');
  expect(await app.flowText()).toMatch(/page "Connection types" size 900x700/);
  await expect(page.locator('#pageInfo')).toContainText('900 × 700 mm');
});

test('setting width then height keeps both as typed, even with content bigger than either one', async({app,page})=>{
  // the fixture's content needs about 501 x 313 mm; typing a size smaller than that on both axes used to let the
  // first field's on-screen value (already grown back by auto-grow) leak into the second field's update, so the
  // first field's floor silently became whatever auto-grow had just shown instead of what was typed
  await app.nothingSelected();
  await setValue(page,'#pPageW','300'); await setValue(page,'#pPageH','200');
  expect(await app.flowText()).toMatch(/page "Connection types" size 300x200/);
  // the page itself is exactly what was typed; the content is still there, past it, shown in grey
  await expect(page.locator('#pageInfo')).toContainText('300 × 200 mm');
  await expect(page.locator('#pageInfo')).toContainText('Shown in grey');
});

test('content past a too-small page shows in grey, uncropped and still fully editable', async({app,page})=>{
  const before=await app.shapes.count();
  await app.nothingSelected();
  await setValue(page,'#pPageW','300'); await setValue(page,'#pPageH','200');
  await expect(page.locator('#pPageW')).toHaveValue('300');
  // nothing was moved, resized or dropped: every shape and connection is still there, still selectable
  await expect(app.shapes).toHaveCount(before);
  await app.click('Team');
  await expect(app.title).toHaveText(/^Shape /);
  // the page rect (what exports/prints) stays at the explicit size; the canvas grows to still show the overflow
  const paper=await page.locator('#paper').evaluate(r=>({w:+r.getAttribute('width'),h:+r.getAttribute('height')}));
  const bg=await page.locator('#pageBg').evaluate(r=>({w:+r.getAttribute('width'),h:+r.getAttribute('height')}));
  expect(bg.w).toBeGreaterThan(paper.w); expect(bg.h).toBeGreaterThan(paper.h);
});

test('a newly added page defaults to A4 landscape', async({app,page})=>{
  await page.getByRole('button',{name:'Add a page'}).click();
  await app.nothingSelected();
  expect(await app.flowText()).toMatch(/page "Page-1" size 297x210/);
  await expect(page.locator('#pageInfo')).toContainText('297 × 210 mm');
  await expect(page.locator('#pPagePreset')).toHaveValue('a4l');
});

test('a page size preset sets an exact size', async({app,page})=>{
  // a new, empty page, so the fixture's own content (which needs more room than A4) cannot grow it back
  await page.getByRole('button',{name:'Add a page'}).click();
  await app.nothingSelected();
  await page.selectOption('#pPagePreset','a4p');
  expect(await app.flowText()).toMatch(/page "Page-1" size 210x297/);
  await expect(page.locator('#pageInfo')).toContainText('210 × 297 mm');
  await expect(page.locator('#pPageW')).toHaveValue('210');
  await expect(page.locator('#pPageH')).toHaveValue('297');
});

test('every A size from A5 to A1 is offered, in both orientations', async({page})=>{
  const values=await page.locator('#pPagePreset option').evaluateAll(os=>os.map(o=>o.value));
  for(const n of [1,2,3,4,5]) for(const o of ['p','l']) expect(values).toContain(`a${n}${o}`);
});

test('the preset follows the page size, and falls back to Custom for anything else', async({app,page})=>{
  await page.getByRole('button',{name:'Add a page'}).click();
  await app.nothingSelected();
  await page.selectOption('#pPagePreset','a4p');
  await expect(page.locator('#pPagePreset')).toHaveValue('a4p');
  await setValue(page,'#pPageW','400'); await setValue(page,'#pPageH','300');
  await expect(page.locator('#pPagePreset')).toHaveValue('custom');
});

test('Fit page to content shrinks an oversized page back down to its content', async({app,page})=>{
  await app.nothingSelected();
  await setValue(page,'#pPageW','900'); await setValue(page,'#pPageH','700');
  await page.click('#pFitPage');
  const text=await page.locator('#pageInfo').textContent();
  const [,w,h]=text.match(/(\d+) × (\d+) mm/);
  expect(+w).toBeLessThan(900); expect(+h).toBeLessThan(700);
  expect(+w).toBeGreaterThanOrEqual(50); expect(+h).toBeGreaterThanOrEqual(50);
});

test('a page can be renamed from the Page panel, and the tab follows', async({app,page})=>{
  await app.nothingSelected();
  await setValue(page,'#pPageName','Renamed page');
  await expect(page.locator('#tabs button').first()).toHaveText('Renamed page');
  expect(await app.flowText()).toMatch(/^page "Renamed page"/m);
});

test('a page can be deleted from the Page panel, and the last page cannot', async({app,page})=>{
  await page.getByRole('button',{name:'Add a page'}).click();
  await expect(page.locator('#tabs button')).toHaveCount(3);   // Connection types, Page-1, +
  await app.nothingSelected();
  page.once('dialog',d=>d.accept());
  await page.click('#pDeletePage');
  await expect(page.locator('#tabs button')).toHaveCount(2);
  await expect(page.locator('#tabs button').first()).toHaveText('Connection types');

  // one page left: Delete this page is disabled, and clicking it (were it not) would refuse anyway
  await expect(page.locator('#pDeletePage')).toBeDisabled();
});

test('dragging a shape past the page edge grows the page to fit it', async({app,page})=>{
  const before=await page.locator('#pageInfo').textContent();
  const [,beforeW,beforeH]=before.match(/(\d+) × (\d+) mm/);
  const paper=await page.locator('#paper').evaluate(r=>r.getBoundingClientRect());
  const c=await app.centreOf(app.shape('Step A'));
  // drag well past the current page's bottom-right corner, regardless of current zoom
  await app.drag(c,{x:paper.x+paper.width+400,y:paper.y+paper.height+400});
  await page.keyboard.press('Escape');   // the Page panel (and its live pageInfo text) only shows with nothing selected
  const after=await page.locator('#pageInfo').textContent();
  const [,afterW,afterH]=after.match(/(\d+) × (\d+) mm/);
  expect(+afterW).toBeGreaterThan(+beforeW);
  expect(+afterH).toBeGreaterThan(+beforeH);
});

test('dragging a shape past an explicitly sized page leaves the page size alone, and grows the grey area instead', async({app,page})=>{
  await app.nothingSelected();
  await setValue(page,'#pPageW','150'); await setValue(page,'#pPageH','100');
  const paper=await page.locator('#paper').evaluate(r=>r.getBoundingClientRect());
  const c=await app.centreOf(app.shape('Step A'));
  await app.drag(c,{x:paper.x+paper.width+400,y:paper.y+paper.height+400});
  await page.keyboard.press('Escape');
  await expect(page.locator('#pageInfo')).toContainText('150 × 100 mm');
  const bg=await page.locator('#pageBg').evaluate(r=>({w:+r.getAttribute('width'),h:+r.getAttribute('height')}));
  const paperNow=await page.locator('#paper').evaluate(r=>({w:+r.getAttribute('width'),h:+r.getAttribute('height')}));
  expect(bg.w).toBeGreaterThan(paperNow.w); expect(bg.h).toBeGreaterThan(paperNow.h);
});
