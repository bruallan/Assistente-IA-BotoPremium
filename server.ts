import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './src/knowledge-base.ts';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Array to store the uploaded files URIs
let uploadedFiles: any[] = [];
let isUploadingManuals = false;

// Function to upload PDFs to Gemini File API
async function uploadManuals() {
  if (isUploadingManuals) return;
  isUploadingManuals = true;
  console.log('Iniciando upload dos manuais em PDF para o Gemini...');
  const manualsDir = path.join(__dirname, 'manuals');
  
  if (!fs.existsSync(manualsDir)) {
    console.log('Diretório "manuals" não encontrado. Crie a pasta e adicione os PDFs.');
    isUploadingManuals = false;
    return;
  }

  const files = fs.readdirSync(manualsDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  
  if (files.length === 0) {
    console.log('Nenhum PDF encontrado na pasta "manuals".');
    isUploadingManuals = false;
    return;
  }

  const newUploadedFiles = [];

  for (const file of files) {
    const filePath = path.join(manualsDir, file);
    console.log(`Fazendo upload de ${file}...`);
    try {
      let uploadedFile = await ai.files.upload({
        file: filePath,
        mimeType: 'application/pdf',
      });
      
      console.log(`Upload concluído: ${uploadedFile.name}. Aguardando processamento...`);
      
      // Aguardar o processamento do arquivo no Gemini
      while (uploadedFile.state === 'PROCESSING') {
        await new Promise(resolve => setTimeout(resolve, 5000));
        uploadedFile = await ai.files.get({ name: uploadedFile.name });
      }
      
      if (uploadedFile.state === 'FAILED') {
        console.error(`Falha ao processar o arquivo ${file} no Gemini.`);
        continue;
      }

      newUploadedFiles.push(uploadedFile);
      console.log(`Arquivo ${uploadedFile.name} processado e pronto para uso!`);
    } catch (error) {
      console.error(`Erro ao fazer upload de ${file}:`, error);
    }
  }
  
  uploadedFiles = newUploadedFiles;
  isUploadingManuals = false;
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
      if (isUploadingManuals) {
        return res.json({ text: "Estou lendo e processando os manuais da franquia no momento. Isso pode levar alguns minutos. Por favor, tente perguntar novamente em instantes." });
      }

      const { message, history } = req.body;

      // Format history for Gemini API
      const contents = history.map((msg: any, index: number) => {
        const parts: any[] = [{ text: msg.content }];
        
        // Append PDFs to the first user message in the conversation
        if (index === 0 && msg.role === 'user') {
          for (const file of uploadedFiles) {
            parts.push({
              fileData: {
                fileUri: file.uri,
                mimeType: file.mimeType
              }
            });
          }
        }
        
        return {
          role: msg.role === 'user' ? 'user' : 'model',
          parts: parts
        };
      });
      
      // Add the new user message
      const newUserParts: any[] = [{ text: message }];
      
      // If there is no history, this is the first message, so append PDFs here
      if (history.length === 0) {
        for (const file of uploadedFiles) {
          newUserParts.push({
            fileData: {
              fileUri: file.uri,
              mimeType: file.mimeType
            }
          });
        }
      }
      
      contents.push({ role: 'user', parts: newUserParts });

      // Build System Instruction
      const systemParts: any[] = [
        { text: SYSTEM_INSTRUCTION }
      ];

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
