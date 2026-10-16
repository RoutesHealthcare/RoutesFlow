import {test, expect} from './fixtures.js';

/* Regression for a bug in layoutPage()'s incremental placement (flow/sync.js): once a page has both placed and
   unplaced shapes, each unplaced one is positioned next to a neighbour one at a time, guarded against runaway
   retries by a loop counter capped against the shrinking remaining-count. That cap shrinks faster than the
   counter grows, so once there are more than a handful of unplaced shapes the loop always stops early and leaves
   some of them with no position at all -- buildModel() then crashes reading x off that missing position the
   moment anything on the page is next edited (e.g. dragging any one shape to place it). */
test('a page with one placed shape and ten unplaced ones lays out without crashing', async({app,page})=>{
  await page.keyboard.press('Control+e');
  const lines=['flow 1','page "Page-1"','a: process "A" @ 15,15'];
  for(let i=1;i<=10;i++) lines.push(`b${i}: process "B${i}"`);
  lines.push('a -> b1');
  for(let i=1;i<10;i++) lines.push(`b${i} -> b${i+1}`);
  const code=page.locator('#codeText');
  await code.fill(lines.join('\n'));
  await code.blur();
  await expect(page.locator('#tpStatus')).not.toContainText('Could not');
  await expect(app.shapes).toHaveCount(11+10);   // 11 shapes, 10 connections, every one of them drawn
});
