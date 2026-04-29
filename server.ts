import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './src/knowledge-base.ts';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
const firebaseConfig = require('./firebase-applet-config.json');

import { processManualsForRAG, searchKnowledgeBase } from './src/ragService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId
  });
}
const db = admin.firestore(firebaseConfig.firestoreDatabaseId);

// --- AUTHENTICATION SETUP ---
const AUTHORIZED_EMAILS = ['brunoallan004@gmail.com'];
const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura_aqui';
const otpStore = new Map<string, { code: string; expiresAt: number }>();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.status(200).send('OK');
  });

  // --- AUTH ROUTES ---
  app.post('/api/auth/request-code', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email é obrigatório.' });
    if (!AUTHORIZED_EMAILS.includes(email.toLowerCase())) {
      return res.status(403).json({ error: 'Este email não está autorizado a acessar o sistema.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    otpStore.set(email.toLowerCase(), { code, expiresAt });
    console.log(`[AUTH] Código gerado para ${email}: ${code}`);

    let devCode = null;
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        await transporter.sendMail({
          from: `"Assistente de Manuais" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: 'Seu código de acesso',
          text: `Olá!\n\nSeu código de acesso para o Assistente de Manuais é: ${code}\n\nEste código expira em 10 minutos.`,
          html: `<p>Olá!</p><p>Seu código de acesso: <strong style="font-size: 24px;">${code}</strong></p><p>Este código expira em 10 minutos.</p>`,
        });
      } catch (error) {
        console.error(`[AUTH] Erro ao enviar email para ${email}:`, error);
      }
    } else {
      devCode = code;
    }
    res.json({ message: 'Código enviado.', devCode });
  });

  app.post('/api/auth/verify-code', (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email e código paramétros obrigatórios.' });
    
    const storedData = otpStore.get(email.toLowerCase());
    if (!storedData) return res.status(400).json({ error: 'Nenhum código para este email.' });
    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(email.toLowerCase());
      return res.status(400).json({ error: 'O código expirou. Solicite um novo.' });
    }
    if (storedData.code !== code) return res.status(400).json({ error: 'Código incorreto.' });

    otpStore.delete(email.toLowerCase());
    const token = jwt.sign({ email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email: email.toLowerCase() });
  });

  // --- FIREBASE CHAT HISTORY ROUTES ---
  app.get('/api/chats', authenticateToken, async (req: any, res: any) => {
    try {
      const email = req.user.email;
      const snapshot = await db.collection('chats')
          .where('ownerEmail', '==', email)
          .orderBy('updatedAt', 'desc')
          .limit(10)
          .get();
      
      const chats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(chats);
    } catch (err) {
      console.error('Erro ao buscar chats:', err);
      res.status(500).json({ error: 'Erro ao buscar o histórico de chats.' });
    }
  });

  app.get('/api/chats/:id/messages', authenticateToken, async (req: any, res: any) => {
     try {
       const email = req.user.email;
       const chatId = req.params.id;
       
       const chatDoc = await db.collection('chats').doc(chatId).get();
       if (!chatDoc.exists || chatDoc.data()?.ownerEmail !== email) {
           return res.status(403).json({ error: 'Acesso negado a este chat.' });
       }

       const snapshot = await db.collection('chats').doc(chatId).collection('messages')
           .orderBy('createdAt', 'asc')
           .get();
           
       const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
       res.json(messages);
     } catch (err) {
       console.error('Erro ao buscar mensagens:', err);
       res.status(500).json({ error: 'Erro ao buscar as mensagens do chat.' });
     }
  });

  // -- CHAT AI ROUTE --
  app.post('/api/chat', authenticateToken, async (req: any, res: any) => {
    try {
      const { message, history, chatId } = req.body;
      const userEmail = req.user.email;

      // Ensure Chat Document Exists
      let targetChatId = chatId;
      if (!targetChatId) {
          const chatRef = db.collection('chats').doc();
          targetChatId = chatRef.id;
          await chatRef.set({
             ownerEmail: userEmail,
             title: message.substring(0, 40) + (message.length > 40 ? '...' : ''),
             createdAt: admin.firestore.FieldValue.serverTimestamp(),
             updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
      } else {
          await db.collection('chats').doc(targetChatId).update({
             updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
      }

      // Save User Message to Firestore
      const userMsgRef = db.collection('chats').doc(targetChatId).collection('messages').doc();
      await userMsgRef.set({
          role: 'user',
          content: message,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Format history
      const contents = history.map((msg: any) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));
      
      // Perform RAG for current message
      const topChunks = await searchKnowledgeBase(db, message, 3);
      let ragContext = '';
      if (topChunks.length > 0) {
          ragContext = '\n\n**CONTEXTO EXTRAÍDO DOS MANUAIS DA FRANQUIA PARA REFERÊNCIA:**\n';
          topChunks.forEach((c: any, i: number) => {
             ragContext += `\nTrecho ${i+1} (do arquivo ${c.source}):\n"${c.text}"\n`;
          });
      }

      // Final user message constructed with RAG
      const newUserParts: any[] = [{ text: message + ragContext }];
      contents.push({ role: 'user', parts: newUserParts });

      const systemParts: any[] = [{ text: SYSTEM_INSTRUCTION }];

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Chat-Id', targetChatId); // Client can read this to know the chat ID
      res.flushHeaders();

      try {
        const responseStream = await ai.models.generateContentStream({
          model: 'gemini-2.5-flash',
          contents: contents,
          config: {
             systemInstruction: { parts: systemParts },
             temperature: 0.1,
          }
        });

        let fullAiText = '';
        for await (const chunk of responseStream) {
          if (chunk.text) {
            fullAiText += chunk.text;
            res.write(`data: ${JSON.stringify({ text: chunk.text, chatId: targetChatId })}\n\n`);
          }
        }
        res.write('data: [DONE]\n\n');
        
        // Save AI Message to Firestore
        const aiMsgRef = db.collection('chats').doc(targetChatId).collection('messages').doc();
        await aiMsgRef.set({
            role: 'model',
            content: fullAiText,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.end();
      } catch (modelError: any) {
        console.error('Error from Gemini:', modelError);
        res.write(`data: ${JSON.stringify({ error: modelError.message })}\n\n`);
        res.end();
      }
    } catch (error) {
      console.error('Error in /chat route:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro interno do servidor.' });
      } else {
        res.write(`data: ${JSON.stringify({ error: 'Erro interno no servidor.' })}\n\n`);
        res.end();
      }
    }
  });

  // -- WHATSAPP API INTEGRATION --
  const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'boto_premium_verify_token_123';
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'EAAi9ZAZAvaAqQBRbY1KpELQn5KxQ4J9qUHYhmWpDQpY5ZCNknGaHnZCeVQoNYCHYJV8zbGD0ZC8IoK4MRmFXV6f9mqpmMuvMkPlIFmCMjnJm1yJ8ZCJ8UoCQdERZA9JwBWeuik5hTtZA24kUFxORTsKHvxItYhCMJIYPZALVunQZBOTxiqBpN5SUTZA6tmsqEHadO23dgZDZD';
  const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1166257203227529';

  app.get('/webhook', (req: any, res: any) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];
    
    if (mode && token) {
      if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(400);
    }
  });

  async function sendWhatsAppMessage(to: string, text: string) {
    try {
      await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to,
          type: 'text',
          text: { body: text }
        })
      });
    } catch (e) {
      console.error('Erro ao enviar mensagem no WhatsApp:', e);
    }
  }

  app.post('/webhook', async (req: any, res: any) => {
    const body = req.body;
    
    if (body.object) {
      if (
        body.entry && body.entry[0].changes && body.entry[0].changes[0] &&
        body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]
      ) {
        let phoneNumberId = body.entry[0].changes[0].value.metadata.phone_number_id;
        let from = body.entry[0].changes[0].value.messages[0].from; 
        let payloadMsg = body.entry[0].changes[0].value.messages[0];

        // Send 200 OK immediately
        res.sendStatus(200);

        if (payloadMsg.type === 'text') {
           let msgBody = payloadMsg.text.body;
           handleWhatsAppMessageAsync(from, msgBody);
        }
      } else {
        res.sendStatus(200);
      }
    } else {
      res.sendStatus(404);
    }
  });

  async function handleWhatsAppMessageAsync(from: string, message: string) {
    try {
      const whatsappUserEmail = `whatsapp:${from}`;
      
      // Get or Create Chat for this WhatsApp User
      const chatsSnapshot = await db.collection('chats')
          .where('ownerEmail', '==', whatsappUserEmail)
          .orderBy('updatedAt', 'desc')
          .limit(1)
          .get();

      let targetChatId = '';
      if (chatsSnapshot.empty) {
          const chatRef = db.collection('chats').doc();
          targetChatId = chatRef.id;
          await chatRef.set({
             ownerEmail: whatsappUserEmail,
             title: `WhatsApp: ${from}`,
             createdAt: admin.firestore.FieldValue.serverTimestamp(),
             updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
      } else {
          targetChatId = chatsSnapshot.docs[0].id;
          await db.collection('chats').doc(targetChatId).update({
             updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
      }

      // Fetch Chat History
      const msgsSnapshot = await db.collection('chats').doc(targetChatId).collection('messages')
           .orderBy('createdAt', 'asc')
           .limit(20)
           .get();

      const history = msgsSnapshot.docs.map(doc => doc.data());

      // Save User Message
      await db.collection('chats').doc(targetChatId).collection('messages').doc().set({
          role: 'user',
          content: message,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const contents = history.map((msg: any) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      // RAG Search
      const topChunks = await searchKnowledgeBase(db, message, 3);
      let ragContext = '';
      if (topChunks.length > 0) {
          ragContext = '\n\n**CONTEXTO EXTRAÍDO DOS MANUAIS DA FRANQUIA PARA REFERÊNCIA:**\n';
          topChunks.forEach((c: any, i: number) => {
             ragContext += `\nTrecho ${i+1} (do arquivo ${c.source}):\n"${c.text}"\n`;
          });
      }

      const newUserParts: any[] = [{ text: message + ragContext }];
      contents.push({ role: 'user', parts: newUserParts });

      const systemParts: any[] = [{ text: SYSTEM_INSTRUCTION }];

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
        config: {
           systemInstruction: { parts: systemParts },
           temperature: 0.1,
        }
      });

      const aiText = response.text || 'Desculpe, não consegui gerar uma resposta.';

      // Save AI Response
      await db.collection('chats').doc(targetChatId).collection('messages').doc().set({
          role: 'model',
          content: aiText,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Send to WhatsApp
      await sendWhatsAppMessage(from, aiText);

    } catch (e: any) {
      console.error('Erro ao processar mensagem do WhatsApp:', e);
      await sendWhatsAppMessage(from, "Desculpe, encontrei um erro interno ao processar sua dúvida. Tente novamente mais tarde.");
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Inicia o processamento RAG dos manuais em background
    processManualsForRAG(db).catch(console.error);

    setInterval(() => {
      const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
      fetch(`${appUrl}/api/health`).catch(() => {});
    }, 14 * 60 * 1000);
  });
}

startServer();
