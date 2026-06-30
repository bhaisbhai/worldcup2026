import { chromium } from 'playwright';
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to wait
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function runTest() {
  console.log('🚀 Starting Vite dev server...');
  const devServer = spawn('npm', ['run', 'dev'], {
    cwd: path.resolve(__dirname, '..'),
    shell: true
  });

  let serverUrl = null;

  const serverReady = new Promise((resolve) => {
    devServer.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Vite] ${output.trim()}`);
      
      const match = output.match(/http:\/\/localhost:(\d+)\//);
      if (match) {
        serverUrl = match[0];
        console.log(`🚀 Detected Vite server running at: ${serverUrl}`);
        resolve();
      }
    });
  });

  await Promise.race([
    serverReady,
    wait(10000).then(() => { throw new Error('Timeout waiting for Vite server to start'); })
  ]);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Log browser console logs and page errors
  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.error(`[Browser PageError] ${err}`));

  // Log network requests
  page.on('request', req => console.log(`[Request] ${req.method()} ${req.url()}`));
  page.on('requestfailed', req => console.error(`[Request Failed] ${req.url()}: ${req.failure().errorText}`));
  page.on('response', res => console.log(`[Response] ${res.status()} ${res.url()}`));

  // Mock the GET request to return a leaderboard of 10 scores
  await page.route('**/api/game-scores*', async (route) => {
    if (route.request().method() === 'GET') {
      console.log('📡 Intercepted GET /api/game-scores, returning mock leaderboard...');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scores: [
            { name: "CHAMP", score: 100, combo: 10, perfects: 5, date: "23/06" },
            { name: "PRO", score: 80, combo: 8, perfects: 4, date: "23/06" },
            { name: "P3", score: 60, combo: 6, perfects: 3, date: "23/06" },
            { name: "P4", score: 50, combo: 5, perfects: 2, date: "23/06" },
            { name: "P5", score: 40, combo: 4, perfects: 1, date: "23/06" },
            { name: "P6", score: 30, combo: 3, perfects: 0, date: "23/06" },
            { name: "P7", score: 20, combo: 2, perfects: 0, date: "23/06" },
            { name: "P8", score: 15, combo: 1, perfects: 0, date: "23/06" },
            { name: "P9", score: 10, combo: 1, perfects: 0, date: "23/06" },
            { name: "P10", score: 5, combo: 1, perfects: 0, date: "23/06" }
          ]
        })
      });
    } else if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData());
      console.log('📡 Intercepted POST /api/game-scores with body:', body);
      
      if (body.name === 'RAJA ARJAN' && body.score === 8) {
        console.log('✅ Assert passed: Submitted name is "RAJA ARJAN" and score is 8.');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true })
        });
      } else {
        console.error('❌ Assert failed: Unexpected POST body:', body);
        await route.fulfill({ status: 400 });
      }
    }
  });

  try {
    console.log(`🌐 Opening game page at ${serverUrl}...`);
    await page.goto(serverUrl, { waitUntil: 'networkidle' });

    // Open game overlay which triggers keepy-uppy.js script load
    console.log('🎮 Triggering openGame()...');
    await page.evaluate(() => {
      // Calling the global openGame function in index.html
      if (typeof window.openGame === 'function') {
        window.openGame();
      } else {
        throw new Error('openGame function not found on window');
      }
    });

    // Wait for the script to load and define window._debugGameOver
    console.log('⏳ Waiting for _debugGameOver to be defined...');
    await page.waitForFunction(() => typeof window._debugGameOver === 'function', { timeout: 10000 });
    console.log('🎉 _debugGameOver is successfully defined!');

    // Wait for canvas to be visible
    await page.waitForSelector('#game', { state: 'visible' });
    console.log('🎮 Game canvas is visible, selecting character...');

    // Wait a brief moment for rendering to stabilize
    await wait(1000);

    // Simulate clicking in the center of the first card to select Big Meeks
    const boundingBox = await page.locator('#game').boundingBox();
    const clickX = boundingBox.x + (98 * boundingBox.width / 360);
    const clickY = boundingBox.y + (166 * boundingBox.height / 640);
    await page.mouse.click(clickX, clickY);
    console.log('👤 Clicked character portrait.');
    await wait(300);

    // Click "KICK OFF!" button
    const kickOffX = boundingBox.x + (180 * boundingBox.width / 360);
    const kickOffY = boundingBox.y + (592 * boundingBox.height / 640);
    await page.mouse.click(kickOffX, kickOffY);
    console.log('⚽ Clicked Kick Off! Game started.');
    await wait(500);

    // Trigger gameover with a score of 8
    console.log('⚡ Triggering debug gameover with score 8 (qualifies for 10th rank)...');
    await page.evaluate(() => {
      window._debugGameOver(8, 2, 1);
    });

    // Wait for the name prompt modal to appear
    console.log('⏳ Waiting for name prompt modal...');
    await page.waitForSelector('#_gameNamePrompt', { timeout: 3000 });
    console.log('🎉 Name prompt modal is visible!');

    // Get input element and type
    const inputSelector = '#_gameNameInput';
    const input = page.locator(inputSelector);
    
    // Type name with space: 'RAJA ARJAN'
    console.log('⌨️ Typing "RAJA ARJAN"...');
    await input.focus();
    await page.keyboard.type('RAJA ARJAN');
    await wait(300);

    const typedValue = await input.inputValue();
    console.log(`📝 Input field value is: "${typedValue}"`);

    if (typedValue === 'RAJA ARJAN') {
      console.log('✅ Spacebar typing check PASSED! Space character was successfully preserved.');
    } else {
      throw new Error(`❌ Spacebar typing check FAILED! Value is "${typedValue}" (expected "RAJA ARJAN")`);
    }

    // Click SAVE SCORE button
    console.log('💾 Clicking Save Score...');
    await page.click('#_gameNameSave');

    // Wait for network requests to finish
    await wait(1000);
    console.log('🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exitCode = 1;
  } finally {
    console.log('🛑 Cleaning up browser and server...');
    await browser.close();
    devServer.kill();
    console.log('👋 Goodbye!');
  }
}

runTest();
