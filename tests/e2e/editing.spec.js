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
