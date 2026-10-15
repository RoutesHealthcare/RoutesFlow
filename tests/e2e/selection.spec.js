import {test, expect} from './fixtures.js';

test.beforeEach(async({app})=>{ await app.open(); });

test('clicking a shape selects it', async({app})=>{
  await app.click('Step A');
  await expect(app.title).toHaveText('Shape a1');
  await expect(app.selectionBoxes).toHaveCount(1);
});

test('clicking on a connection selects it', async({app,page})=>{
  const p=await app.connectionPoint('next');   // the a1 -> a2 connection
  await page.mouse.click(p.x,p.y+3);   // a few pixels off the line still counts
  await expect(app.title).toHaveText('Connection');
});

test('shift+click adds to and removes from the selection', async({app})=>{
  await app.click('Step A');
  await app.click('Form',{modifiers:['Shift']});
  await expect(app.title).toHaveText('2 items selected');
  await app.click('Step A',{modifiers:['Shift']});
  await expect(app.title).toHaveText('Shape b1');
});

test('Ctrl+A selects everything and Escape clears it', async({app,page})=>{
  await page.keyboard.press('Control+a');
  await expect(app.title).toHaveText(/^\d+ items selected$/);
  await page.keyboard.press('Escape');
  await app.nothingSelected();
});

test('dragging a box on empty page selects only what is fully inside', async({app})=>{
  const a=await app.shape('Step A').boundingBox(), b=await app.shape('Step B').boundingBox();
  await app.drag({x:a.x-20,y:a.y-15},{x:b.x+b.width+20,y:b.y+b.height+15});
  await expect(app.title).toHaveText('3 items selected');   // two shapes and the connection between them
  await expect(app.selectionBoxes).toHaveCount(3);
});

test('Alt+click selects the shape underneath', async({app,page})=>{
  const a=await app.centreOf(app.shape('Step A')), f=await app.centreOf(app.shape('Form'));
  await app.drag(f,a);   // put Form on top of Step A
  await page.keyboard.press('Escape');
  await page.mouse.click(a.x,a.y);
  await expect(app.title).toHaveText('Shape b1');
  await page.keyboard.down('Alt'); await page.mouse.click(a.x,a.y); await page.keyboard.up('Alt');
  await expect(app.title).toHaveText('Shape a1');
});
