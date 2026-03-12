import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'fake_key_1234567890' });

async function run() {
  try {
    const file = await ai.files.get({ name: 'files/123' });
    console.log(file.state);
  } catch (e) {
    console.error('Error:', e);
  }
}
run();
