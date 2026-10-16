import {readFile} from 'node:fs/promises';
import JSZip from 'jszip';
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

test('a page can be exported as a PNG or a PDF', async({app,page},testInfo)=>{
  await app.open();
  await page.click('#btnExport');
  for(const [fmt,ext,magic] of [['png','png',[0x89,0x50,0x4E,0x47]],['pdf','pdf',[0x25,0x50,0x44,0x46]]]){
    await page.selectOption('#exportFmt',fmt);
    await expect(page.locator('#exportText')).toBeHidden();
    const [download]=await Promise.all([page.waitForEvent('download'),page.click('#exportDownload')]);
    expect(download.suggestedFilename()).toBe(`connection-types.${ext}`);
    const file=testInfo.outputPath(`snapshot.${ext}`); await download.saveAs(file);
    const bytes=await readFile(file);
    expect([...bytes.subarray(0,magic.length)]).toEqual(magic);
    expect(bytes.length).toBeGreaterThan(200);
  }
});

test('a PNG export crops to the page size, not the grey area past it', async({app,page},testInfo)=>{
  await app.open();
  await app.nothingSelected();
  // the fixture's content needs about 501 x 313 mm; an explicit page smaller than that leaves content showing
  // in grey past the page, which the export should crop out rather than include
  await page.locator('#pPageW').evaluate(i=>{ i.value='100'; i.dispatchEvent(new Event('change')); });
  await page.locator('#pPageH').evaluate(i=>{ i.value='80'; i.dispatchEvent(new Event('change')); });
  await page.click('#btnExport'); await page.selectOption('#exportFmt','png');
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#exportDownload')]);
  const file=testInfo.outputPath('cropped.png'); await download.saveAs(file);
  const bytes=await readFile(file);
  // PNG: signature (8 bytes), then the IHDR chunk's length+type (8 bytes), then width and height as big-endian uint32s
  const w=bytes.readUInt32BE(16), h=bytes.readUInt32BE(20);
  // 100 x 80 mm at 96 px/inch, oversampled 2x by the exporter
  expect(w).toBe(Math.round((100/25.4*96)*2));
  expect(h).toBe(Math.round((80/25.4*96)*2));
});

test('the export file name can be set, for every export type', async({app,page})=>{
  await app.open();
  await page.click('#btnExport');
  await page.fill('#exportName','My Diagram');
  for(const [fmt,ext] of [['mermaid','mmd'],['png','png'],['pdf','pdf']]){
    await page.selectOption('#exportFmt',fmt);
    const [download]=await Promise.all([page.waitForEvent('download'),page.click('#exportDownload')]);
    expect(download.suggestedFilename()).toBe(`My Diagram.${ext}`);
  }
});

test('a multi-page drawing exports one PNG per page in a zip, and every page in one PDF', async({app,page},testInfo)=>{
  await app.open();
  await page.getByRole('button',{name:'Add a page'}).click();
  await page.click('#btnExport');

  await page.selectOption('#exportFmt','png');
  const [pngDownload]=await Promise.all([page.waitForEvent('download'),page.click('#exportDownload')]);
  expect(pngDownload.suggestedFilename()).toMatch(/\.zip$/);
  const zipFile=testInfo.outputPath('pages.zip'); await pngDownload.saveAs(zipFile);
  const zip=await JSZip.loadAsync(await readFile(zipFile));
  const names=Object.keys(zip.files);
  expect(names).toHaveLength(2);
  for(const name of names) expect(name).toMatch(/\.png$/);

  await page.selectOption('#exportFmt','pdf');
  const [pdfDownload]=await Promise.all([page.waitForEvent('download'),page.click('#exportDownload')]);
  expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfFile=testInfo.outputPath('pages.pdf'); await pdfDownload.saveAs(pdfFile);
  const pdfText=(await readFile(pdfFile)).toString('latin1');
  expect(pdfText.match(/\/Type\/Page\/Parent/g)||[]).toHaveLength(2);
});
