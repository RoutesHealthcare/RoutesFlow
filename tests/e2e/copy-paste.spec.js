import {test, expect} from './fixtures.js';

test.beforeEach(async({app})=>{ await app.open(); });

test('Ctrl+C then Ctrl+V pastes a copy and selects it', async({app,page})=>{
  await app.click('Step A');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(app.shape('Step A')).toHaveCount(2);
  await expect(app.title).toHaveText(/^Shape /);   // the pasted copy is selected; it gets its own generated id, not "a1"
});

test('pasting twice makes two separate copies, each offset further', async({app,page})=>{
  await app.click('Step A');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  const first=await app.shape('Step A').nth(1).boundingBox();
  await page.keyboard.press('Control+v');
  await expect(app.shape('Step A')).toHaveCount(3);
  const second=await app.shape('Step A').nth(2).boundingBox();
  expect(second.x).toBeGreaterThan(first.x);
});

test('pasting after editing the original reflects the edit', async({app,page})=>{
  await app.click('Step A');
  await page.keyboard.press('Control+c');
  await setColour(page,'#pFill','#ff0000');
  await page.keyboard.press('Control+v');
  for(const i of [0,1]) await expect(app.shape('Step A').nth(i).locator('path[fill="#FF0000"]')).toHaveCount(1);
});

test('copying a shape and its connection pastes both, reconnected to each other', async({app,page})=>{
  await app.click('Step A'); await app.click('Step B',{modifiers:['Shift']});
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(app.shape('Step A')).toHaveCount(2);
  await expect(app.shape('Step B')).toHaveCount(2);
  const edges=[...(await app.flowText()).matchAll(/^(\S+)\s+\S+\s+(\S+).*: "next"/gm)];
  expect(edges.length).toBe(2);   // the original a1->a2, plus a new copy
  const [,from,to]=edges[1];
  expect(from).not.toBe('a1'); expect(to).not.toBe('a2');   // glued to the new shapes, not the originals
});

const setColour=(page,id,hex)=>page.locator(id).evaluate((i,v)=>{ i.value=v; i.dispatchEvent(new Event('change')); },hex);
