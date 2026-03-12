import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './src/knowledge-base.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Array to store the uploaded files URIs
let uploadedFiles: any[] = [];

// Function to upload PDFs to Gemini File API
async function uploadManuals() {
  console.log('Iniciando upload dos manuais em PDF para o Gemini...');
  const manualsDir = path.join(__dirname, 'manuals');
  
  if (!fs.existsSync(manualsDir)) {
    console.log('Diretório "manuals" não encontrado. Crie a pasta e adicione os PDFs.');
    return;
  }

  const files = fs.readdirSync(manualsDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  
  if (files.length === 0) {
    console.log('Nenhum PDF encontrado na pasta "manuals".');
    return;
  }

  const newUploadedFiles = [];

  for (const file of files) {
    const filePath = path.join(manualsDir, file);
    console.log(`Fazendo upload de ${file}...`);
    try {
      const uploadedFile = await ai.files.upload({
        file: filePath,
        mimeType: 'application/pdf',
      });
      newUploadedFiles.push(uploadedFile);
      console.log(`Upload concluído: ${uploadedFile.name}`);
    } catch (error) {
      console.error(`Erro ao fazer upload de ${file}:`, error);
    }
  }
  
  uploadedFiles = newUploadedFiles;
  console.log('Todos os manuais foram carregados com sucesso e estão prontos para uso!');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check endpoint for keep-alive
  app.get('/api/health', (req, res) => {
    res.status(200).send('OK');
  });

  // API Route for Chat
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, history } = req.body;

      // Format history for Gemini API
      const contents = history.map((msg: any) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));
      
      // Add the new user message
      contents.push({ role: 'user', parts: [{ text: message }] });

      // Build System Instruction with Text + PDFs
      const systemParts: any[] = [
        { text: SYSTEM_INSTRUCTION }
      ];

      // Append uploaded PDFs to the system instruction
      for (const file of uploadedFiles) {
        systemParts.push({
          fileData: {
            fileUri: file.uri,
            mimeType: file.mimeType
          }
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: contents,
        config: {
          systemInstruction: { parts: systemParts },
          temperature: 0.1, // Low temperature for factual answers
        }
      });

      res.json({ text: response.text });
    } catch (error) {
      console.error('Error generating content:', error);
      res.status(500).json({ error: 'Erro ao processar a mensagem no servidor.' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Static serving for production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Upload manuals after server starts listening
    await uploadManuals();
    
    // Re-upload every 24 hours (Gemini File API keeps files for 48h)
    setInterval(uploadManuals, 24 * 60 * 60 * 1000);

    // Keep-alive ping to prevent Render free tier from sleeping
    // Render sleeps after 15 minutes of inactivity. We ping every 14 minutes.
    setInterval(() => {
      const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
      fetch(`${appUrl}/api/health`)
        .then(res => console.log(`[Keep-Alive] Pinged ${appUrl} - Status: ${res.status}`))
        .catch(err => console.error(`[Keep-Alive] Ping failed:`, err.message));
    }, 14 * 60 * 1000);
  });
}

startServer();
