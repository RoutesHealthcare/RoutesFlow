import {test, expect} from './fixtures.js';

const card=page=>page.locator('#tour');
const stepTitle=page=>page.locator('#tourTitle');

test.describe('first visit',()=>{
  test.use({tourSeen:false});

  test('the tour opens by itself once, and not on later visits', async({app,page})=>{
    await expect(card(page)).toBeVisible();
    await expect(stepTitle(page)).toHaveText('Welcome');
    await page.click('#tourEnd');
    await expect(card(page)).toBeHidden();
    await page.reload();
    await expect(page.locator('#canvas')).toBeVisible();
    await expect(card(page)).toBeHidden();
  });

  test('each step moves on when the user does it', async({app,page})=>{
    await page.click('#tourNext');   // Start
    await expect(stepTitle(page)).toHaveText('Add a shape');
    await expect(page.locator('.palette [data-kind="process"]')).toHaveClass(/tour-target/);
    await page.click('.palette [data-kind="process"]');

    await expect(stepTitle(page)).toHaveText('Edit its text');
    const first=app.shapes.last(), c1=await app.centreOf(first);
    await page.mouse.click(c1.x,c1.y); await page.mouse.click(c1.x,c1.y);
    await page.keyboard.type('Assess'); await page.keyboard.press('Control+Enter');

    await expect(stepTitle(page)).toHaveText('Add another shape');
    await page.click('.palette [data-kind="decision"]');
    await expect(stepTitle(page)).toHaveText('Connect them');
    const c2=await app.centreOf(app.shapes.last());
    await app.drag(c2,{x:c2.x+220,y:c2.y});   // move the new shape off the first one
    const second={x:c2.x+220,y:c2.y};

    await page.click('#toolConnect');
    await app.drag(c1,second);
    await expect(stepTitle(page)).toHaveText('Select several');

    await page.keyboard.press('Escape');
    await app.drag({x:c1.x-120,y:c1.y-90},{x:second.x+120,y:second.y+90});
    await expect(stepTitle(page)).toHaveText('Work on the selection');

    await page.click('#tourNext'); await page.click('#tourNext');
    await expect(stepTitle(page)).toHaveText('Save and share');
    await page.click('#tourNext');   // Finish
    await expect(card(page)).toBeHidden();
    await expect(page.locator('.tour-target')).toHaveCount(0);
  });
});

test('the Tour button replays the tour after it has been seen', async({app,page})=>{
  await expect(card(page)).toBeHidden();
  await page.click('#btnTour');
  await expect(card(page)).toBeVisible();
  await expect(stepTitle(page)).toHaveText('Welcome');
});

test('a waiting step can be skipped', async({app,page})=>{
  await page.click('#btnTour'); await page.click('#tourNext');
  await expect(page.locator('#tourNext')).toHaveText('Skip this step');
  await page.click('#tourNext');
  await expect(stepTitle(page)).toHaveText('Edit its text');
});
