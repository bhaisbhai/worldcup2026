const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const candidateModels = [
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-pro-latest",
  "gemini-3-flash-preview"
];

async function main() {
  for (const model of candidateModels) {
    console.log(`🤖 Requesting model: ${model}...`);
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: "Say hello",
      });
      console.log(`✅ Success for ${model}! Response: ${response.text.trim()}`);
      break;
    } catch (error) {
      console.warn(`❌ Error for ${model}:`, error.message || error);
    }
  }
}

main();
