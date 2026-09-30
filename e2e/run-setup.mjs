// Steps 1–3: sign up, connect a model, create videos.
import { BASE, LLM_URL, SHOTS, launch, step, summary } from './lib.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync(SHOTS, { recursive: true });

const { browser, page } = await launch();
const email = `user${Date.now()}@example.com`;

try {
  await step('redirects to login and shows the branded screen', async () => {
    await page.goto(BASE);
    await page.waitForURL('**/login');
    await page.getByText('Describe a video.').waitFor();
    await page.screenshot({ path: `${SHOTS}/01-login.png` });
  });

  await step('signup validates and creates an account', async () => {
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.getByText('Use at least 8 characters').waitFor();
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.waitForURL('**/setup');
  });

  await step('model setup: list loads automatically, test & save', async () => {
    await page.getByRole('radio', { name: 'Custom' }).click();
    await page.getByLabel('Base URL').fill(LLM_URL);
    await page.getByLabel('API key').fill('wrong-key');
    await page.getByText('The provider rejected the API key').waitFor();
    await page.getByLabel('API key').fill('test-key');
    await page.getByText('2 models available.').waitFor();
    await page.getByRole('combobox', { name: 'Model' }).fill('mock-plain');
    await page.screenshot({ path: `${SHOTS}/02-setup.png` });
    await page.getByRole('button', { name: 'Test & save' }).click();
    await page.getByText('did not call the test function').waitFor();
    const model = page.getByRole('combobox', { name: 'Model' });
    await model.fill('mock-tools');
    await page.getByRole('button', { name: 'Test & save' }).click();
    await page.waitForURL(BASE + '/');
  });

  await step('dashboard: empty state, create a blank video and the demo', async () => {
    await page.getByText('Make your first video').waitFor();
    await page.screenshot({ path: `${SHOTS}/03-empty.png` });
    await page.getByRole('button', { name: 'New video' }).first().click();
    await page.getByLabel('Name').fill('Lumademy logo intro');
    await page.getByRole('button', { name: 'Create video' }).click();
    await page.waitForURL('**/p/*');
    await page.goto(BASE);
    await page.getByRole('button', { name: 'New video' }).first().click();
    await page.getByLabel('Name').fill('Demo reel');
    await page.getByRole('radio', { name: /Demo reel/ }).click();
    await page.getByRole('button', { name: 'Create video' }).click();
    await page.waitForURL('**/p/*');
    await page.goto(BASE);
    await page.getByText('Demo reel').waitFor();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/04-dashboard.png` });
  });
  summary();
} finally {
  await browser.close();
}
