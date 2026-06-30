import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

async function main() {
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.list();
    console.log("Response type:", typeof response);
    console.log("Response keys:", Object.keys(response));
    if (response.models) {
      console.log("models type:", typeof response.models);
      console.log("models keys:", Object.keys(response.models));
      console.log("models length:", response.models.length);
      if (response.models.length > 0) {
        console.log("First model keys:", Object.keys(response.models[0]));
        console.log("First model name:", response.models[0].name);
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
