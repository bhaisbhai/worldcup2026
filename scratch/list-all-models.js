import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

async function main() {
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.list();
    if (response.pageInternal) {
      console.log("FIRST PAGE MODEL NAMES:");
      console.log(response.pageInternal.map(m => m.name));
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

main();
