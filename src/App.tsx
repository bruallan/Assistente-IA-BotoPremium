import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Mail, KeyRound, LogOut, MessageSquare, Plus, Menu, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

type Message = {
  id: string;
  role: 'user' | 'model';
  content: string;
};

type ChatHistory = {
  id: string;
  title: string;
  updatedAt: any;
};

export default function App() {
  // --- AUTH STATE ---
  const [token, setToken] = useState<string | null>(localStorage.getItem('auth_token'));
  const [authStep, setAuthStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // --- CHAT STATE ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // --- HISTORY STATE ---
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initial load of history if authenticated
  useEffect(() => {
    if (token) {
      loadHistory();
      startNewChat();
    }
  }, [token]);

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/chats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChatHistory(data);
      } else if (res.status === 401 || res.status === 403) {
        handleLogout();
      }
    } catch (e) {
      console.error('Falha ao carregar histórico:', e);
    }
  };

  const loadChat = async (chatId: string) => {
    if (isLoading) return;
    setIsHistoryLoading(true);
    setCurrentChatId(chatId);
    if (window.innerWidth < 768) setIsSidebarOpen(false);

    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (e) {
      console.error('Falha ao carregar mensagens:', e);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const startNewChat = () => {
    if (isLoading) return;
    setCurrentChatId(null);
    setMessages([
      {
        id: '1',
        role: 'model',
        content: 'Olá! Sou o assistente virtual da BotoPremium. Como posso te ajudar hoje com a operação da sua unidade?'
      }
    ]);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  // --- AUTH HANDLERS ---
  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);

    try {
      const res = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Erro ao solicitar código');
      
      if (data.devCode) {
        alert(`[MODO DE TESTE]\nO serviço de e-mail ainda não possui as credenciais configuradas na plataforma de testes.\n\nSeu código de acesso é: ${data.devCode}`);
      }

      setAuthStep('code');
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);

    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Código inválido');
      
      localStorage.setItem('auth_token', data.token);
      setToken(data.token);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setAuthStep('email');
    setEmail('');
    setCode('');
    setChatHistory([]);
    startNewChat();
  };

  // --- CHAT HANDLERS ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !token) return;

    const userMessage = input.trim();
    setInput('');
    
    // Optimistic User Message Update
    const newMessages: Message[] = [...messages, { id: Date.now().toString(), role: 'user', content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const historyToSend = messages.filter(m => m.id !== '1');

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: userMessage,
          history: historyToSend,
          chatId: currentChatId
        }),
      });

      if (response.status === 401 || response.status === 403) {
        handleLogout();
        throw new Error('Sessão expirada. Faça login novamente.');
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro na resposta do servidor');
        
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'model', content: data.text || 'Desculpe, não consegui processar a resposta.' }
        ]);
        setIsLoading(false);
        await loadHistory();
        return;
      }

      if (!response.ok) {
        throw new Error('Erro na resposta do servidor');
      }

      setIsLoading(false);
      const responseId = Date.now().toString();
      setMessages((prev) => [...prev, { id: responseId, role: 'model', content: '' }]);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let aiText = '';
      let buffer = '';
      let serverChatId = currentChatId;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (part.startsWith('data: ')) {
              const dataStr = part.substring(6);
              if (dataStr === '[DONE]') break;
              try {
                const data = JSON.parse(dataStr);
                if (data.chatId && !serverChatId) {
                   serverChatId = data.chatId;
                   setCurrentChatId(data.chatId);
                }
                
                if (data.error) {
                  const errorMsg = typeof data.error === 'string' ? data.error : 
                                  (data.error.message || 'Erro desconhecido na API');
                  
                  if (errorMsg.includes('503') || errorMsg.includes('timed out')) {
                     aiText = "A inteligência artificial do Google (Gemini) está demorando muito para responder neste momento (Servidor sobrecarregado). Por favor, aguarde alguns segundos e tente perguntar novamente.";
                  } else {
                     aiText += `\n\n**Erro:** ${errorMsg}`;
                  }
                  
                  setMessages((prev) => 
                    prev.map(m => m.id === responseId ? { ...m, content: aiText } : m)
                  );
                } else if (data.text) {
                  aiText += data.text;
                  setMessages((prev) => 
                    prev.map(m => m.id === responseId ? { ...m, content: aiText } : m)
                  );
                }
              } catch (e) {
                console.error("Erro ao fazer parse do chunk:", e);
              }
            }
          }
        }
      }
      // Finished stream, reload history to update title/time
      await loadHistory();
    } catch (error: any) {
      console.error('Erro ao enviar mensagem:', error);
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: 'model', content: error.message || 'Ocorreu um erro ao conectar com o servidor.' }
      ]);
      setIsLoading(false);
    }
  };

  // --- RENDER LOGIN SCREEN ---
  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-xl">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-yellow-600 p-3 rounded-xl mb-4">
              <Bot className="w-8 h-8 text-zinc-950" />
            </div>
            <h1 className="text-2xl font-semibold text-gray-100">Acesso Restrito</h1>
            <p className="text-zinc-400 text-center mt-2">
              Assistente Virtual Exclusivo para Franqueados BotoPremium
            </p>
          </div>

          {authError && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-lg mb-6 text-sm text-center">
              {authError}
            </div>
          )}

          {authStep === 'email' ? (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Email do Franqueado</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-zinc-500" />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full pl-10 bg-zinc-950 border border-zinc-700 rounded-xl py-2.5 text-gray-200 focus:ring-1 focus:ring-yellow-500 focus:border-yellow-500 transition-colors"
                    placeholder="seu@email.com"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isAuthLoading || !email}
                className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-zinc-950 bg-yellow-600 hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50 transition-colors"
              >
                {isAuthLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Receber Código de Acesso'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div className="text-center mb-4">
                <p className="text-sm text-zinc-400">
                  Enviamos um código de 6 dígitos para<br/>
                  <strong className="text-gray-200">{email}</strong>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Código de Verificação</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound className="h-5 w-5 text-zinc-500" />
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="block w-full pl-10 bg-zinc-950 border border-zinc-700 rounded-xl py-2.5 text-gray-200 focus:ring-1 focus:ring-yellow-500 focus:border-yellow-500 transition-colors tracking-widest text-center text-lg"
                    placeholder="000000"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isAuthLoading || code.length !== 6}
                className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-zinc-950 bg-yellow-600 hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50 transition-colors"
              >
                {isAuthLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Acessar Assistente'}
              </button>
              <button
                type="button"
                onClick={() => { setAuthStep('email'); setAuthError(''); }}
                className="w-full text-sm text-zinc-400 hover:text-yellow-500 transition-colors mt-2"
              >
                Voltar e usar outro email
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // --- RENDER CHAT SCREEN ---
  return (
    <div className="flex h-screen bg-zinc-950 font-sans overflow-hidden">
      
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:static inset-y-0 left-0 z-40 w-72 bg-zinc-900 border-r border-zinc-800 transition-transform duration-300 ease-in-out flex flex-col`}>
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
           <button 
             onClick={startNewChat}
             className="flex-1 flex items-center justify-center gap-2 bg-yellow-600/10 hover:bg-yellow-600/20 text-yellow-500 border border-yellow-500/20 px-4 py-2.5 rounded-xl transition-colors font-medium"
           >
             <Plus className="w-4 h-4" /> Novo Chat
           </button>
           <button onClick={() => setIsSidebarOpen(false)} className="md:hidden ml-2 p-2 text-zinc-400 hover:text-white">
             <X className="w-5 h-5"/>
           </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          <div className="px-4 mb-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Histórico Recente</div>
          {isHistoryLoading && chatHistory.length === 0 ? (
             <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 text-zinc-500 animate-spin" /></div>
          ) : chatHistory.length === 0 ? (
            <div className="px-4 py-4 text-sm text-zinc-500 text-center">Nenhum chat salvo ainda.</div>
          ) : (
            <ul className="space-y-1 px-2">
              {chatHistory.map((chat) => (
                <li key={chat.id}>
                  <button
                    onClick={() => loadChat(chat.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors ${currentChatId === chat.id ? 'bg-zinc-800 text-yellow-500' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'}`}
                  >
                    <MessageSquare className="w-4 h-4 shrink-0" />
                    <span className="truncate text-sm">{chat.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        
        <div className="p-4 border-t border-zinc-800">
           <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
               <User className="w-4 h-4" />
             </div>
             <div className="flex-1 min-w-0">
               <p className="text-sm font-medium text-white truncate">{email}</p>
             </div>
             <button
                onClick={handleLogout}
                className="p-2 text-zinc-400 hover:text-red-400 transition-colors rounded-lg hover:bg-zinc-800"
                title="Sair"
             >
                <LogOut className="w-4 h-4" />
             </button>
           </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Header */}
        <header className="bg-zinc-900 border-b border-zinc-800 px-4 md:px-6 py-4 flex items-center gap-4 shadow-sm z-10 shrink-0">
          <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 -ml-2 text-zinc-400 hover:text-white">
             <Menu className="w-6 h-6"/>
          </button>
          <div className="flex items-center gap-3">
            <div className="bg-yellow-600 p-2 rounded-lg">
              <Bot className="w-6 h-6 text-zinc-950" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-100 tracking-tight leading-tight">Suporte ao Franqueado</h1>
              <p className="text-xs md:text-sm text-yellow-500/80">Assistente Virtual Oficial</p>
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar */}
              <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-sm ${
                msg.role === 'user' ? 'bg-zinc-800 text-yellow-500 border border-zinc-700' : 'bg-yellow-600 text-zinc-950'
              }`}>
                {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
              </div>

              {/* Message Bubble */}
              <div className={`max-w-[80%] rounded-2xl px-5 py-3.5 shadow-sm ${
                msg.role === 'user' 
                  ? 'bg-zinc-800 text-gray-200 rounded-tr-sm border border-zinc-700' 
                  : 'bg-zinc-900 border border-yellow-500/30 text-gray-200 rounded-tl-sm'
              }`}>
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <div className="prose prose-sm prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-zinc-800 prose-pre:text-gray-200 prose-a:text-yellow-500 hover:prose-a:text-yellow-400">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-4">
              <div className="shrink-0 w-10 h-10 rounded-full bg-yellow-600 text-zinc-950 flex items-center justify-center shadow-sm">
                <Bot className="w-5 h-5" />
              </div>
              <div className="bg-zinc-900 border border-yellow-500/30 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm flex items-center justify-center min-w-[60px]">
                <Loader2 className="w-5 h-5 text-yellow-500 animate-spin" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="bg-zinc-900 border-t border-zinc-800 p-4">
        <div className="max-w-3xl mx-auto">
          <form 
            onSubmit={handleSubmit}
            className="flex items-end gap-3 bg-zinc-950 border border-zinc-700 rounded-2xl p-2 focus-within:ring-1 focus-within:ring-yellow-500/50 focus-within:border-yellow-500/50 transition-all shadow-sm"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Pergunte sobre a operação, royalties, marketing..."
              className="flex-1 max-h-32 min-h-[44px] bg-transparent border-0 focus:ring-0 resize-none py-2.5 px-3 text-gray-200 placeholder:text-zinc-500"
              rows={1}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="shrink-0 bg-yellow-600 text-zinc-950 p-3 rounded-xl hover:bg-yellow-500 disabled:opacity-50 disabled:hover:bg-yellow-600 transition-colors shadow-sm"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          <p className="text-center text-xs text-zinc-500 mt-3">
            O assistente pode cometer erros. Verifique informações críticas nos manuais oficiais.
          </p>
        </div>
      </footer>
      </div>
    </div>
  );
}
