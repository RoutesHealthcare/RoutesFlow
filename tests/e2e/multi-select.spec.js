import {test, expect} from './fixtures.js';

test.beforeEach(async({app})=>{
  await app.open();
  await app.click('Step A'); await app.click('Form',{modifiers:['Shift']});
});

test('dragging moves every selected shape by the same amount', async({app})=>{
  const a0=await app.shape('Step A').boundingBox(), f0=await app.shape('Form').boundingBox();
  const c=await app.centreOf(app.shape('Step A'));
  await app.drag(c,{x:c.x+80,y:c.y+50});
  const a1=await app.shape('Step A').boundingBox(), f1=await app.shape('Form').boundingBox();
  expect(Math.abs((a1.x-a0.x)-(f1.x-f0.x))).toBeLessThan(1);
  expect(Math.abs((a1.y-a0.y)-(f1.y-f0.y))).toBeLessThan(1);
  expect(a1.x-a0.x).toBeGreaterThan(40);
});

test('arrow keys nudge the selection and undo keeps it selected', async({app,page})=>{
  const a0=await app.shape('Step A').boundingBox();
  await page.keyboard.press('Shift+ArrowRight');
  expect((await app.shape('Step A').boundingBox()).x).toBeGreaterThan(a0.x);
  await page.keyboard.press('Control+z');
  expect((await app.shape('Step A').boundingBox()).x).toBeCloseTo(a0.x,0);
  await expect(app.title).toHaveText('2 items selected');
});

test('Delete removes the selection and undo brings it back', async({app,page})=>{
  const n=await app.shapes.count();
  await page.keyboard.press('Delete');
  await expect(app.shape('Step A')).toHaveCount(0);
  await expect(app.shape('Form')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(app.shapes).toHaveCount(n);
});

test('Ctrl+D duplicates the selection and selects the copies', async({app,page})=>{
  await page.keyboard.press('Control+d');
  await expect(app.shape('Step A')).toHaveCount(2);
  await expect(app.shape('Form')).toHaveCount(2);
  await expect(app.title).toHaveText('2 items selected');
});

test('changing fill applies to every selected shape', async({app,page})=>{
  await page.locator('#pFill').evaluate(i=>{ i.value='#ff0000'; i.dispatchEvent(new Event('change')); });
  for(const name of ['Step A','Form'])
    await expect(app.shape(name).locator('path[fill="#FF0000"]')).toHaveCount(1);
});
