import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.setViewportSize({ width: 1000, height: 1000 });

  console.log('Navigating to http://localhost:3000/debug-bracket');
  await page.goto('http://localhost:3000/debug-bracket');
  
  console.log('Waiting for SVG to render');
  await page.waitForSelector('svg');
  
  // Wait a second for rendering / fetches to settle
  await page.waitForTimeout(2000);
  
  const artifactPath = '/Users/rajarjan/.gemini/antigravity/brain/0a2dccc9-dc8b-4f49-8c8a-11d969f09c6c/debug_bracket.png';
  console.log('Saving screenshot to:', artifactPath);
  
  await page.screenshot({ path: artifactPath, fullPage: true });
  
  console.log('Screenshot saved successfully!');
  await browser.close();
}

main().catch(console.error);
