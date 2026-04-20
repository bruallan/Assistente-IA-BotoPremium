import * as admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
let isProcessingRAG = false;

// Cosine similarity for vectors
function cosineSimilarity(A: number[], B: number[]) {
    let dotproduct = 0;
    let mA = 0;
    let mB = 0;
    for(let i = 0; i < A.length; i++){
        dotproduct += (A[i] * B[i]);
        mA += (A[i]*A[i]);
        mB += (B[i]*B[i]);
    }
    mA = Math.sqrt(mA);
    mB = Math.sqrt(mB);
    return (dotproduct)/((mA)*(mB));
}

export async function processManualsForRAG(db: admin.firestore.Firestore) {
    if (isProcessingRAG) return;
    isProcessingRAG = true;
    
    try {
        console.log('[RAG] Verificando banco de dados para os manuais...');
        const existingDocs = await db.collection('knowledge_chunks').limit(1).get();
        if (!existingDocs.empty) {
            console.log('[RAG] Banco de conhecimento já populado. Pulando processamento.');
            isProcessingRAG = false;
            return;
        }

        console.log('[RAG] Banco de conhecimento vazio. Processando manuais PDF...');
        const manualsDir = path.join(__dirname, 'manuals');
        if (!fs.existsSync(manualsDir)) {
            console.log('[RAG] Pasta manuals não encontrada.');
            isProcessingRAG = false;
            return;
        }

        const files = fs.readdirSync(manualsDir).filter(f => f.toLowerCase().endsWith('.pdf'));
        for (const file of files) {
            console.log(`[RAG] Extraindo texto de: ${file}`);
            const dataBuffer = fs.readFileSync(path.join(manualsDir, file));
            const data = await pdfParse(dataBuffer);
            
            // Break text into paragraphs/chunks (approx 1000 chars)
            const sentences = data.text.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/);
            let currentChunk = '';
            const chunks: string[] = [];
            
            for (const sentence of sentences) {
                if ((currentChunk.length + sentence.length) > 1000) {
                    if (currentChunk.trim()) chunks.push(currentChunk.trim());
                    currentChunk = sentence + ' ';
                } else {
                    currentChunk += sentence + ' ';
                }
            }
            if (currentChunk.trim()) chunks.push(currentChunk.trim());

            console.log(`[RAG] Arquivo ${file} dividido em ${chunks.length} partes. Gerando embeddings...`);
            
            const batch = db.batch();
            let batchCount = 0;
            
            // We can embed multiple contents in one call if we want, but letting's just do it in sequence or parallel small batches to avoid rate limits
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                try {
                   const result = await ai.models.embedContent({
                       model: 'text-embedding-004',
                       contents: chunk,
                   });
                   
                   const ref = db.collection('knowledge_chunks').doc();
                   batch.set(ref, {
                       text: chunk,
                       source: file,
                       embedding: result.embeddings[0].values
                   });
                   
                   batchCount++;
                   if (batchCount === 450) {
                       await batch.commit();
                       batchCount = 0;
                   }
                } catch (e: any) {
                   console.error(`[RAG] Erro ao gerar embedding para chunk ${i}:`, e.message);
                }
            }
            if (batchCount > 0) await batch.commit();
            console.log(`[RAG] Concluído o arquivo: ${file}`);
        }
        console.log('[RAG] Todos os manuais processados com sucesso!');
    } catch (error) {
        console.error('[RAG] Erro durante o processamento:', error);
    } finally {
        isProcessingRAG = false;
    }
}

export async function searchKnowledgeBase(db: admin.firestore.Firestore, query: string, topK: number = 4) {
    try {
        console.log(`[RAG] Gerando embedding para a pergunta: "${query}"...`);
        const queryResult = await ai.models.embedContent({
            model: 'text-embedding-004',
            contents: query,
        });
        const queryEmbedding = queryResult.embeddings[0].values;

        // In a real production system, you'd use a Pinecone or Firestore Vector Search extension.
        // For AI Studio prototype, fetching all documents to memory is feasible because the manual size is small.
        console.log(`[RAG] Buscando chunks no banco de dados para calcular similaridade...`);
        const snapshot = await db.collection('knowledge_chunks').get();
        
        type ScoredChunk = { text: string; source: string; score: number };
        const scoredChunks: ScoredChunk[] = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.embedding && data.text) {
                const score = cosineSimilarity(queryEmbedding, data.embedding);
                scoredChunks.push({
                    text: data.text,
                    source: data.source,
                    score
                });
            }
        });

        scoredChunks.sort((a, b) => b.score - a.score);
        const topChunks = scoredChunks.slice(0, topK);
        
        console.log(`[RAG] Melhores resultados encontrados:`);
        topChunks.forEach((c, idx) => console.log(`   #${idx+1} [${c.source}] Score: ${c.score.toFixed(3)}`));
        
        return topChunks;
    } catch (error) {
        console.error('[RAG] Erro durante a busca:', error);
        return [];
    }
}
