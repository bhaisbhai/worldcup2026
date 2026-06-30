import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

async function testModel(modelName) {
  try {
    console.log(`🤖 Testing model: ${modelName}...`);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: modelName,
      contents: "Write a witty one-sentence roast of a defender who made 0 clearances in 90 minutes. Keep it brief.",
    });
    console.log(`✅ Success with ${modelName}:`, response.text);
    return true;
  } catch (error) {
    console.error(`❌ Failed with ${modelName}:`, error.message);
    return false;
  }
}

async function main() {
  const models = [
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-flash-latest'
  ];
  for (const m of models) {
    const success = await testModel(m);
    if (success) {
      console.log(`🎉 Found working model: ${m}`);
      break;
    }
  }
}

main();
