import {test, expect} from './fixtures.js';

test.beforeEach(async({app})=>{ await app.open(); });

test('a second click on the selected shape edits its text', async({app,page})=>{
  await app.click('Step A');
  await expect(app.textEditor).toBeHidden();
  await app.click('Step A');
  await expect(app.textEditor).toBeVisible();
  await page.keyboard.type('Assess needs');
  await page.keyboard.press('Control+Enter');
  await expect(app.shape('Assess needs')).toHaveCount(1);
  expect(await app.flowText()).toContain('a1: process "Assess needs"');
});

test('Enter, F2 and typing all start editing', async({app,page})=>{
  for(const key of ['Enter','F2']){
    await app.click('Step B'); await page.keyboard.press(key);
    await expect(app.textEditor).toBeVisible();
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  }
  await app.click('Step B'); await page.keyboard.type('X');
  await expect(app.textEditor).toHaveValue('X');
});

test('double-click edits text', async({app,page})=>{
  const c=await app.centreOf(app.shape('Manager'));
  await page.mouse.dblclick(c.x,c.y);
  await expect(app.textEditor).toBeVisible();
});

test('Escape cancels an edit', async({app,page})=>{
  await app.click('Step A'); await app.click('Step A');
  await page.keyboard.type('Discard me'); await page.keyboard.press('Escape');
  await expect(app.shape('Step A')).toHaveCount(1);
});

test('dragging a selected shape moves it without editing', async({app})=>{
  await app.click('Step A');
  const before=await app.shape('Step A').boundingBox(), c=await app.centreOf(app.shape('Step A'));
  await app.drag(c,{x:c.x+60,y:c.y+40});
  await expect(app.textEditor).toBeHidden();
  const after=await app.shape('Step A').boundingBox();
  expect(after.x).toBeGreaterThan(before.x+30);
});

test('the properties panel explains how to edit', async({app,page})=>{
  await app.click('Step A');
  await expect(page.locator('#editHint')).toBeVisible();
});

const setColour=(page,id,hex)=>page.locator(id).evaluate((i,v)=>{ i.value=v; i.dispatchEvent(new Event('change')); },hex);

test('the Text colour picker colours a shape\'s text', async({app,page})=>{
  await app.click('Step A');
  await expect(page.locator('#textColWrap')).toBeVisible();
  await setColour(page,'#pTextCol','#fa4616');
  await expect(app.shape('Step A').locator('text')).toHaveAttribute('fill','#FA4616');
  expect(await app.flowText()).toMatch(/a1: process "Step A".*text=#FA4616/);
});

test('the Text colour picker colours a connection label, and text= works on connections', async({app,page})=>{
  const p=await app.connectionPoint('next');
  await page.mouse.click(p.x,p.y+3);
  await expect(app.title).toHaveText('Connection');
  await setColour(page,'#pTextCol','#00b5e2');
  await expect(app.shape('next').locator('text')).toHaveAttribute('fill','#00B5E2');
  expect(await app.flowText()).toMatch(/a1 -> a2 \[[^\]]*text=#00B5E2[^\]]*\] : "next"/);
});

test('the Text colour picker works on several shapes at once', async({app,page})=>{
  await app.click('Step A'); await app.click('Form',{modifiers:['Shift']});
  await setColour(page,'#pTextCol','#006f8e');
  for(const name of ['Step A','Form']) await expect(app.shape(name).locator('text')).toHaveAttribute('fill','#006F8E');
});
