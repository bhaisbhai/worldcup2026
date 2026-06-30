import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

async function main() {
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    // Note: The newer SDK has listModels on ai.models
    const response = await ai.models.list();
    console.log("AVAILABLE MODELS:");
    for (const m of response.models || []) {
      console.log(`- Name: ${m.name}, DisplayName: ${m.displayName}, SupportedMethods: ${m.supportedGenerationMethods}`);
    }
  } catch (err) {
    console.error("Error listing models:", err.message);
  }
}

main();
