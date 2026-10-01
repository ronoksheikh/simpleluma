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
    await page.getByText('Welcome back').waitFor();
    await page.screenshot({ path: `${SHOTS}/01-login.png` });
  });

  await step('signup validates and creates an account', async () => {
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText('Use at least 8 characters').waitFor();
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();
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

  await step('home: empty state, open a blank video, then brief the Director from the home page', async () => {
    await page.getByText('No videos yet').waitFor();
    await page.screenshot({ path: `${SHOTS}/03-empty.png` });
    await page.getByRole('button', { name: /open an empty video/ }).click();
    await page.waitForURL('**/p/*');
    await page.getByText('What shall we direct?').waitFor();
    await page.goto(BASE);
    await page.getByRole('button', { name: /Demo reel/ }).click();
    await page.getByLabel('Describe your video').fill('Explain the demo reel to me');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForURL('**/p/*');
    // The brief went straight to the Director.
    await page.getByText('Explain the demo reel to me').first().waitFor();
    await page.goto(BASE);
    await page.locator('main').getByText('Explain the demo reel').first().waitFor();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/04-home.png` });
  });

  summary();
} finally {
  await browser.close();
}
