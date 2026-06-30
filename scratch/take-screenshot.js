import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.setViewportSize({ width: 1000, height: 1000 });

  console.log('Navigating to http://localhost:3000/');
  await page.goto('http://localhost:3000/');
  
  console.log('Clicking knockout tab');
  await page.click('button.tbtn[data-tab="knockout"]');
  
  console.log('Waiting for circular container');
  await page.waitForSelector('#ko-circular-container svg');
  
  // Wait a second for rendering / async fetches to settle
  await page.waitForTimeout(2000);
  
  const artifactPath = '/Users/rajarjan/.gemini/antigravity/brain/0a2dccc9-dc8b-4f49-8c8a-11d969f09c6c/circular_bracket.png';
  console.log('Saving screenshot to:', artifactPath);
  
  const element = await page.$('#ko-circular-container');
  await element.screenshot({ path: artifactPath });
  
  console.log('Screenshot saved successfully!');
  await browser.close();
}

main().catch(console.error);
