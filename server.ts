import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './src/knowledge-base.ts';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Array to store the uploaded files URIs
let uploadedFiles: any[] = [];
let isUploadingManuals = false;

// --- AUTHENTICATION SETUP ---
const AUTHORIZED_EMAILS = ['brunoallan004@gmail.com'];
const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura_aqui';

// In-memory store for OTP codes (email -> { code, expiresAt })
const otpStore = new Map<string, { code: string; expiresAt: number }>();

// Configure email transporter (Nodemailer)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Seu email do Gmail
    pass: process.env.EMAIL_PASS, // Senha de App do Gmail
  },
});

// Middleware to protect routes
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Token inválido ou expirado.' });
    req.user = user;
    next();
  });
};
// --- END AUTH SETUP ---

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

  // --- AUTH ROUTES ---

  // 1. Request a 6-digit code
  app.post('/api/auth/request-code', async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório.' });
    }

    // Check if email is authorized (Future: This will check the Sults API)
    if (!AUTHORIZED_EMAILS.includes(email.toLowerCase())) {
      return res.status(403).json({ error: 'Este email não está autorizado a acessar o sistema.' });
    }

    // Generate a random 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes from now

    otpStore.set(email.toLowerCase(), { code, expiresAt });

    console.log(`[AUTH] Código gerado para ${email}: ${code}`); // For debugging/fallback

    // Try to send the email
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        await transporter.sendMail({
          from: `"Assistente de Manuais" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: 'Seu código de acesso',
          text: `Olá!\n\nSeu código de acesso para o Assistente de Manuais é: ${code}\n\nEste código expira em 10 minutos.`,
          html: `<p>Olá!</p><p>Seu código de acesso para o Assistente de Manuais é: <strong style="font-size: 24px;">${code}</strong></p><p>Este código expira em 10 minutos.</p>`,
        });
        console.log(`[AUTH] Email enviado com sucesso para ${email}`);
      } catch (error) {
        console.error(`[AUTH] Erro ao enviar email para ${email}:`, error);
      }
    } else {
      console.log('[AUTH] Aviso: EMAIL_USER e EMAIL_PASS não configurados. O email não foi enviado, mas o código foi gerado no console.');
    }

    res.json({ message: 'Código enviado com sucesso.' });
  });

  // 2. Verify the 6-digit code and issue JWT
  app.post('/api/auth/verify-code', (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email e código são obrigatórios.' });
    }

    const storedData = otpStore.get(email.toLowerCase());

    if (!storedData) {
      return res.status(400).json({ error: 'Nenhum código solicitado para este email.' });
    }

    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(email.toLowerCase());
      return res.status(400).json({ error: 'O código expirou. Solicite um novo.' });
    }

    if (storedData.code !== code) {
      return res.status(400).json({ error: 'Código incorreto.' });
    }

    // Code is valid! Delete it so it can't be reused
    otpStore.delete(email.toLowerCase());

    // Generate JWT token
    const token = jwt.sign({ email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '7d' }); // Token valid for 7 days

    res.json({ token, email: email.toLowerCase() });
  });

  // --- END AUTH ROUTES ---

  // API Route for Chat
  app.post('/api/chat', authenticateToken, async (req, res) => {
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

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      try {
        const responseStream = await ai.models.generateContentStream({
          model: 'gemini-2.5-flash',
          contents: contents,
          config: {
            systemInstruction: { parts: systemParts },
            temperature: 0.1, // Low temperature for factual answers
          }
        });

        for await (const chunk of responseStream) {
          if (chunk.text) {
            res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
          }
        }
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (modelError: any) {
        console.error('Error from Gemini API:', modelError);
        res.write(`data: ${JSON.stringify({ error: modelError.message || 'Erro ao processar a mensagem na API.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (error) {
      console.error('Error generating content:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro interno ao processar a mensagem no servidor.' });
      } else {
        res.write(`data: ${JSON.stringify({ error: 'Erro interno no servidor.' })}\n\n`);
        res.end();
      }
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
