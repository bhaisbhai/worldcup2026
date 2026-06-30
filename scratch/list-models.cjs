const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function main() {
  console.log("🔍 Listing all available models...");
  try {
    const response = await ai.models.list();
    let count = 0;
    for await (const model of response) {
      console.log(`- Model: ${model.name}`);
      count++;
    }
    console.log(`Total models found: ${count}`);
  } catch (error) {
    console.error("❌ Error listing models:", error);
  }
}

main();
