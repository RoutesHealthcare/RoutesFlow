import {test, expect} from './fixtures.js';

const list=page=>page.locator('#suggest');
const options=page=>page.locator('#suggest li .sg-label');

test.beforeEach(async({app,page})=>{
  await app.open();
  await page.keyboard.press('Control+e');
  await page.locator('#codeText').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
});
const lastLine=async page=>(await page.locator('#codeText').inputValue()).split('\n').pop();

test('suggests shape types after "id:" and puts the caret in the label quotes', async({page})=>{
  await page.keyboard.type('n1: pro');
  await expect(list(page)).toBeVisible();
  await expect(options(page).first()).toHaveText('process');
  await page.keyboard.press('Enter');
  await page.keyboard.type('New step');
  expect(await lastLine(page)).toBe('n1: process "New step"');
});

test('suggests connection types after a shape id, then the shapes on the page', async({page})=>{
  await page.keyboard.type('a1 ');
  await expect(options(page).filter({hasText:/^->$/})).toHaveCount(1);
  await expect(options(page).filter({hasText:/^-data->$/})).toHaveCount(1);
  await page.keyboard.press('Enter');                       // the first suggestion is the plain sequence arrow
  await expect(list(page)).toBeVisible();                   // straight on to the shapes
  await page.keyboard.type('a');
  await expect(options(page).first()).toHaveText('a2');      // a1 itself is not offered
  await page.keyboard.press('Tab');
  expect(await lastLine(page)).toBe('a1 -> a2');
});

test('suggests settings inside [ ] and then their values', async({page})=>{
  await page.keyboard.type('n2: process "X" [fi');
  await expect(options(page).first()).toHaveText('fill=');
  await page.keyboard.press('Enter');
  await expect(options(page).first()).toHaveText('#FA4616');
  await expect(page.locator('#suggest li').first()).toContainText('Blood Orange');
  await page.keyboard.press('Enter');
  expect(await lastLine(page)).toBe('n2: process "X" [fill=#FA4616');
});

test('Ctrl+Space opens suggestions on an empty line; Escape closes them', async({page})=>{
  await page.keyboard.press('Control+Space');
  await expect(options(page).filter({hasText:/^page$/})).toHaveCount(1);
  await expect(options(page).filter({hasText:/^a1$/})).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(list(page)).toBeHidden();
  await expect(page.locator('#codeText')).toBeFocused();   // Escape closed the list, not the editor
});

test('Tab still indents when no list is open, and nothing is suggested inside quotes', async({page})=>{
  await page.keyboard.press('Tab');
  expect(await lastLine(page)).toBe('  ');
  await page.keyboard.type('n3: process "pro');
  await expect(list(page)).toBeHidden();
});

test('a page line suggests size and direction values', async({page})=>{
  await page.keyboard.type('page "Two" size ');
  await expect(options(page).first()).toHaveText('297x210');
  await page.keyboard.press('Escape'); await page.keyboard.type('297x210 direction ');
  await expect(options(page).filter({hasText:/^LR$/})).toHaveCount(1);
});
