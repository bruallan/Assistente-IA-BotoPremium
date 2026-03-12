# Assistente de Franqueados

Este é um projeto **Full-Stack (React + Vite + Express)** pronto para produção. Ele foi estruturado para proteger sua chave da API do Gemini no backend, sendo a arquitetura ideal para colocar no ar.

## 🚀 Como fazer o Deploy (Passo a Passo)

Como este projeto possui um backend em Node.js (Express) para proteger a chave da API, a **Render.com** é a plataforma gratuita mais fácil e recomendada para hospedá-lo (a Vercel é otimizada para Next.js, enquanto a Render é perfeita para Express + Vite).

### Passo 1: Exportar para o GitHub
1. Aqui no AI Studio, clique no ícone de **Configurações (engrenagem)** no canto superior direito.
2. Selecione **"Export to GitHub"**.
3. Siga o fluxo para criar um repositório na sua conta do GitHub com este código exato.

### Passo 2: Hospedar de Graça na Render
1. Crie uma conta gratuita em [Render.com](https://render.com).
2. No painel, clique em **"New +"** e selecione **"Web Service"**.
3. Conecte sua conta do GitHub e selecione o repositório que você acabou de exportar.
4. Preencha as configurações do deploy:
   * **Name:** `assistente-franquia` (ou o nome que preferir)
   * **Environment:** `Node`
   * **Build Command:** `npm install && npm run build`
   * **Start Command:** `npm start`
5. **Configurar a Chave da API (CRÍTICO):**
   * Role a página para baixo até a seção **"Environment Variables"** (Variáveis de Ambiente).
   * Clique em **"Add Environment Variable"**.
   * **Key:** `GEMINI_API_KEY`
   * **Value:** `[Cole sua chave do Google AI Studio aqui]`
6. Clique no botão **"Create Web Service"** no final da página.

Pronto! A Render vai baixar seu código, construir a interface e iniciar o servidor. Em alguns minutos, você receberá um link público (ex: `assistente-franquia.onrender.com`) para enviar aos seus franqueados.

---

## 🛠️ Como adicionar a Base de Conhecimento (PDFs)
Para que a IA leia e interprete seus manuais (textos e imagens):
1. Coloque todos os arquivos `.pdf` (ex: Manual Comercial, Manual Técnico, etc.) dentro da pasta `manuals/` na raiz do projeto.
2. O sistema fará o upload automático desses PDFs para a API do Gemini sempre que o servidor for iniciado.
3. Para atualizar as instruções de comportamento da IA, edite o arquivo `src/knowledge-base.ts`.
4. Faça o commit e o push para o GitHub. A Render fará o deploy da nova versão automaticamente!
