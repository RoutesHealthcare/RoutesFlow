import {test, expect} from './fixtures.js';

test('every text export produces output', async({app,page})=>{
  await app.open();
  await page.click('#btnExport');
  for(const [fmt,start] of [['mermaid','%%'],['plantuml','@startuml'],['activity','@startuml'],['dot','//'],['drawio','<mxfile']]){
    await page.selectOption('#exportFmt',fmt);
    await expect(page.locator('#exportText')).toHaveValue(new RegExp('^'+start.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
});

test('a Mermaid import creates selectable shapes', async({app,page})=>{
  await page.click('#btnImport');
  await page.fill('#importText','flowchart TD\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]');
  await page.click('#importGo');
  await expect(app.shape('Check')).toHaveCount(1);
  await app.click('Check');
  await expect(app.title).toHaveText(/^Shape /);
});

test('a Visio export opens again and stays editable', async({app,page},testInfo)=>{
  await app.open();
  const n=await app.shapes.count();
  await page.click('#btnExport'); await page.selectOption('#exportFmt','vsdx');
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#exportDownload')]);
  const file=testInfo.outputPath('round-trip.vsdx'); await download.saveAs(file);
  await page.reload();
  await app.importFile(file);
  await expect(app.shapes).toHaveCount(n);
  await app.click('Step A'); await app.click('Step A');
  await expect(app.textEditor).toBeVisible();
});
