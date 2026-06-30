const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function main() {
  console.log("🤖 Requesting gemini-2.0-flash-lite...");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-lite",
      contents: "Say hello",
    });
    console.log("Success! Response:", response.text);
  } catch (error) {
    console.error("❌ Error requesting gemini-2.0-flash-lite:", error);
  }
}

main();
