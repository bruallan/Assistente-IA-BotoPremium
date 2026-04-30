import { useState, useEffect } from 'react';
import { Loader2, Trash2, FileText, UploadCloud, File, AlertCircle, PlusCircle, X } from 'lucide-react';

interface KnowledgeFile {
  id: string;
  filename: string;
  uploadedAt: any;
}

export function AdminKnowledgeBase({ token, onClose }: { token: string; onClose: () => void }) {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFiles();
  }, [token]);

  const loadFiles = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/knowledge', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
      } else {
        const err = await res.json();
        setError(err.error || 'Erro ao carregar arquivos.');
      }
    } catch (e: any) {
       setError(e.message || 'Erro de conexão.');
    } finally {
       setIsLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
     const file = e.target.files?.[0];
     if (!file) return;

     if (!file.name.toLowerCase().endsWith('.pdf')) {
         setError('Por favor, selecione apenas arquivos PDF.');
         return;
     }

     setIsUploading(true);
     setError(null);
     
     const formData = new FormData();
     formData.append('file', file);
     
     try {
       const res = await fetch('/api/admin/knowledge/upload', {
         method: 'POST',
         headers: { 'Authorization': `Bearer ${token}` },
         body: formData
       });
       
       if (res.ok) {
           e.target.value = '';
           await loadFiles();
       } else {
           const err = await res.json();
           setError(err.error || 'Erro ao fazer upload do arquivo.');
       }
     } catch (err: any) {
         setError(err.message || 'Erro de conexão.');
     } finally {
         setIsUploading(false);
     }
  };

  const handleDelete = async (id: string, filename: string) => {
      if (!window.confirm(`Tem certeza que deseja remover o arquivo "${filename}"?\nIsso apagará o arquivo e todos os seus trechos da base de conhecimento.`)) {
          return;
      }
      try {
         setIsLoading(true);
         const res = await fetch(`/api/admin/knowledge/${id}`, {
             method: 'DELETE',
             headers: { 'Authorization': `Bearer ${token}` }
         });
         if (res.ok) {
             setFiles(files.filter(f => f.id !== id));
         } else {
             const err = await res.json();
             setError(err.error || 'Erro ao excluir o arquivo.');
         }
      } catch (err: any) {
         setError(err.message || 'Erro de conexão.');
      } finally {
         setIsLoading(false);
      }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden relative">
       {/* Header */}
       <header className="bg-zinc-900 border-b border-zinc-800 px-4 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                <FileText className="w-5 h-5" />
             </div>
             <div>
                <h2 className="text-xl font-semibold text-gray-100">Base de Conhecimento</h2>
                <p className="text-xs text-indigo-400/80">Gerencie os arquivos usados pela IA</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors">
              <X className="w-5 h-5"/>
          </button>
       </header>

       <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
              
              {/* Upload Section */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                 <h3 className="text-lg font-medium text-white mb-2">Adicionar Novo Arquivo</h3>
                 <p className="text-sm text-zinc-400 mb-6">Faça o upload de manuais em formato PDF para enriquecer a base de conhecimento.</p>
                 
                 {error && (
                    <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex gap-3 text-red-400">
                       <AlertCircle className="w-5 h-5 shrink-0" />
                       <p className="text-sm">{error}</p>
                    </div>
                 )}

                 <div className="relative">
                    <input 
                      type="file" 
                      accept=".pdf" 
                      onChange={handleUpload} 
                      disabled={isUploading}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <div className={`w-full flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl transition-colors ${isUploading ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-zinc-700 hover:border-indigo-500 hover:bg-zinc-800/50'}`}>
                       {isUploading ? (
                          <div className="flex flex-col items-center gap-3">
                             <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                             <p className="text-sm font-medium text-indigo-400">Processando e vetorizando documento...</p>
                          </div>
                       ) : (
                          <div className="flex flex-col items-center gap-3">
                             <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400">
                                <UploadCloud className="w-6 h-6" />
                             </div>
                             <p className="text-sm font-medium text-zinc-300">Clique ou arraste um PDF aqui para fazer upload</p>
                             <p className="text-xs text-zinc-500">O arquivo será lido e dividido automaticamente.</p>
                          </div>
                       )}
                    </div>
                 </div>
              </div>

              {/* Files List */}
              <div className="space-y-4">
                 <h3 className="text-lg font-medium text-white">Arquivos Processados</h3>
                 
                 {isLoading && !isUploading ? (
                    <div className="flex justify-center p-12">
                       <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                    </div>
                 ) : files.length === 0 ? (
                    <div className="text-center p-12 bg-zinc-900 border border-zinc-800 rounded-2xl">
                        <File className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                        <p className="text-zinc-400 font-medium">Nenhum arquivo na base de conhecimento.</p>
                    </div>
                 ) : (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                       <ul className="divide-y divide-zinc-800">
                          {files.map(file => (
                             <li key={file.id} className="p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors">
                                <div className="flex items-center gap-4">
                                   <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
                                      <FileText className="w-5 h-5" />
                                   </div>
                                   <div>
                                      <p className="text-sm border-white font-medium text-zinc-200">{file.filename}</p>
                                      {file.uploadedAt && (
                                         <p className="text-xs text-zinc-500">
                                            Adicionado em: {new Date(file.uploadedAt._seconds * 1000).toLocaleDateString('pt-BR')}
                                         </p>
                                      )}
                                   </div>
                                </div>
                                <button
                                   onClick={() => handleDelete(file.id, file.filename)}
                                   disabled={isLoading || isUploading}
                                   className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors disabled:opacity-50"
                                   title="Excluir arquivo"
                                >
                                   <Trash2 className="w-5 h-5" />
                                </button>
                             </li>
                          ))}
                       </ul>
                    </div>
                 )}
              </div>
          </div>
       </div>
    </div>
  );
}
