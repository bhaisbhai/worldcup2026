const dotenv = require('dotenv');

console.log("Preset GEMINI_API_KEY in shell:", process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.slice(0, 10) + '...' + process.env.GEMINI_API_KEY.slice(-5) : 'not defined');

dotenv.config({ override: true });

console.log("GEMINI_API_KEY after override:", process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.slice(0, 10) + '...' + process.env.GEMINI_API_KEY.slice(-5) : 'not defined');
