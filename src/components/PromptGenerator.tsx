import React, { useState, useRef, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc, Timestamp } from 'firebase/firestore';
import { PromptItem } from '../types';
import { 
  Sparkles, UploadCloud, Image as ImageIcon, RotateCcw, RotateCw, 
  FlipHorizontal, FlipVertical, RefreshCw, Sliders, Copy, Check, Trash2, History 
} from 'lucide-react';

interface PromptGeneratorProps {
  userId: string;
}

export default function PromptGenerator({ userId }: PromptGeneratorProps) {
  // Image states
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [isDragging, setIsDragging] = useState(false);
  
  // Transform states
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>('free');

  // Configuration states
  const [promptStyle, setPromptStyle] = useState('descriptive');
  const [customInstructions, setCustomInstructions] = useState('');
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Generated Output state
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  // History state
  const [history, setHistory] = useState<PromptItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const modifiers = [
    { label: '🌅 Golden Hour', value: 'dramatic golden hour lighting' },
    { label: '🌌 Cyberpunk Neon', value: 'neon cyberpunk synthwave lighting' },
    { label: '🎬 Cinematic Moody', value: 'moody cinematic volumetric fog and film grain' },
    { label: '📸 Studio Bokeh', value: 'soft studio portrait lighting with bokeh background' },
    { label: '🖌️ Oil Painting', value: 'ultra-detailed oil painting masterpiece art style' },
    { label: '✏️ Line-Art', value: 'clean minimalist line-art aesthetic' },
    { label: '🎨 Watercolor Ink', value: 'vibrant watercolor and ink wash illustration style' },
    { label: '⚡ Hyper-Real', value: 'photorealistic 8k octane render hyper-detailed texture' },
  ];

  // Load user generation history
  useEffect(() => {
    fetchHistory();
  }, [userId]);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    const path = `users/${userId}/prompts`;
    try {
      const q = query(collection(db, path), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const items: PromptItem[] = [];
      querySnapshot.forEach((docSnapshot) => {
        items.push({ id: docSnapshot.id, ...docSnapshot.data() } as PromptItem);
      });
      setHistory(items);
    } catch (err) {
      console.error('Error fetching prompt history:', err);
      // Fail gracefully silently or report
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorText('Please select a valid image file.');
      return;
    }
    setMimeType(file.type);
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setImageBase64(e.target.result as string);
        setErrorText(null);
        // Reset transforms
        setRotation(0);
        setFlipH(false);
        setFlipV(false);
        setAspectRatio('free');
      }
    };
    reader.readAsDataURL(file);
  };

  const triggerBrowse = () => {
    fileInputRef.current?.click();
  };

  const toggleModifier = (value: string) => {
    setSelectedModifiers(prev => {
      const isSelected = prev.includes(value);
      const updated = isSelected ? prev.filter(m => m !== value) : [...prev, value];
      
      // Auto-update custom instructions with style guidelines
      if (updated.length === 0) {
        setCustomInstructions('');
      } else {
        setCustomInstructions(`Render style guidelines: ${updated.join(', ')}.`);
      }
      return updated;
    });
  };

  const clearModifiers = () => {
    setSelectedModifiers([]);
    setCustomInstructions('');
  };

  const resetTransforms = () => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setAspectRatio('free');
  };

  const handleCopy = async (text: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // Simple feedback using alert or setting state. We will show custom copied success on standard state
      const button = document.getElementById(id || 'copy-main');
      if (button) {
        const originalText = button.innerHTML;
        button.innerHTML = '✓ Copied';
        setTimeout(() => {
          button.innerHTML = originalText;
        }, 1500);
      }
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  // Process image transforms onto canvas to send high quality rotated/flipped image to backend
  const getProcessedImageBase64 = (): Promise<string> => {
    return new Promise((resolve) => {
      if (!imageBase64) {
        resolve('');
        return;
      }

      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) {
          resolve(imageBase64);
          return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(imageBase64);
          return;
        }

        // Calculate size based on rotation
        const isOrtho = rotation % 180 !== 0;
        const width = isOrtho ? img.height : img.width;
        const height = isOrtho ? img.width : img.height;

        // Apply max size limit to keep network transfers fast
        const MAX_SIZE = 1200;
        let scale = 1;
        if (width > MAX_SIZE || height > MAX_SIZE) {
          scale = MAX_SIZE / Math.max(width, height);
        }

        canvas.width = width * scale;
        canvas.height = height * scale;

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
        ctx.drawImage(img, -img.width * scale / 2, -img.height * scale / 2, img.width * scale, img.height * scale);

        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = imageBase64;
    });
  };

  const generatePrompt = async () => {
    if (!imageBase64) return;
    setIsGenerating(true);
    setErrorText(null);
    setGeneratedPrompt(null);

    try {
      const finalImageBase64 = await getProcessedImageBase64();

      const response = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: finalImageBase64,
          mimeType: 'image/jpeg',
          promptType: promptStyle,
          customInstructions: customInstructions
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned error ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      const resultText = data.prompt;
      setGeneratedPrompt(resultText);

      // Save to Firebase database
      const path = `users/${userId}/prompts`;
      try {
        await addDoc(collection(db, path), {
          userId,
          prompt: resultText,
          promptType: promptStyle,
          customInstructions: customInstructions,
          createdAt: Timestamp.now()
        });
        fetchHistory(); // Refresh history list
      } catch (dbErr) {
        handleFirestoreError(dbErr, OperationType.CREATE, path);
      }

    } catch (err: any) {
      console.error('Error generating prompt:', err);
      setErrorText(err.message || 'Gemini encountered an issue analyzing the image.');
    } finally {
      setIsGenerating(false);
    }
  };

  const deletePromptFromHistory = async (promptId: string) => {
    const path = `users/${userId}/prompts/${promptId}`;
    try {
      await deleteDoc(doc(db, 'users', userId, 'prompts', promptId));
      setHistory(prev => prev.filter(p => p.id !== promptId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  return (
    <div className="flex flex-col gap-8 w-full max-w-7xl mx-auto px-4 md:px-0">
      <canvas ref={canvasRef} className="hidden" />

      {/* Main Grid: Workspace & Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Workspace: Image Area (col-span-7) */}
        <div id="image-workspace" className="lg:col-span-7 bg-zinc-900/50 border border-zinc-800/80 rounded-[2rem] p-6 shadow-xl flex flex-col gap-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-900/5 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-zinc-800 rounded-lg text-indigo-400 flex items-center justify-center">
                <ImageIcon className="w-4 h-4" />
              </span>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Source Image Workspace</h2>
            </div>
            {imageBase64 && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Loaded & Transformed
              </span>
            )}
          </div>

          {/* Drag & Drop Input Zone */}
          {!imageBase64 ? (
            <div 
              id="drop-zone"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={triggerBrowse}
              className={`border border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center min-h-[380px] flex-grow ${
                isDragging 
                  ? 'border-indigo-500 bg-indigo-950/20 scale-[0.99]' 
                  : 'border-zinc-850 hover:border-indigo-500/50 bg-zinc-900/20 hover:bg-zinc-900/40'
              }`}
            >
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden" 
                accept="image/*" 
              />
              <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl shadow-inner mb-4 text-zinc-500">
                <UploadCloud className="w-10 h-10 text-indigo-500" />
              </div>
              <p className="font-semibold text-zinc-200 text-base mb-1">Drag and drop your image here</p>
              <p className="text-zinc-500 text-xs mb-6 tracking-wide">Supports PNG, JPG, JPEG, WEBP</p>
              <button 
                type="button" 
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg shadow-indigo-900/20 transition-all active:scale-95"
              >
                Browse Files
              </button>
            </div>
          ) : (
            /* Img Workspace view */
            <div className="flex flex-col gap-4 flex-grow z-10">
              <div 
                className="bg-zinc-950 rounded-2xl overflow-hidden relative border border-zinc-800 flex items-center justify-center min-h-[350px] max-h-[480px] p-4"
                style={{
                  backgroundImage: 'radial-gradient(#27272a 1px, transparent 1px)',
                  backgroundSize: '16px 16px'
                }}
              >
                <div 
                  className="transition-transform duration-200 ease-out"
                  style={{
                    transform: `rotate(${rotation}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`,
                    aspectRatio: aspectRatio === '1:1' ? '1/1' : aspectRatio === '4:3' ? '4/3' : aspectRatio === '16:9' ? '16/9' : aspectRatio === '9:16' ? '9/16' : 'auto',
                    maxHeight: '100%',
                    maxWidth: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <img 
                    src={imageBase64} 
                    alt="Source Image" 
                    className="max-w-full max-h-[380px] object-contain rounded-lg"
                  />
                </div>
              </div>

              {/* Aspect Ratio Preset Controls */}
              <div className="flex flex-col gap-2 bg-zinc-900/80 p-4 rounded-2xl border border-zinc-800/60">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Aspect Ratio Selector</span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Free Form', value: 'free' },
                    { label: '1:1 Sq', value: '1:1' },
                    { label: '4:3 Photo', value: '4:3' },
                    { label: '16:9 Cinematic', value: '16:9' },
                    { label: '9:16 Portrait', value: '9:16' },
                  ].map(ratio => (
                    <button
                      key={ratio.value}
                      type="button"
                      onClick={() => setAspectRatio(ratio.value)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                        aspectRatio === ratio.value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700/80'
                      }`}
                    >
                      {ratio.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Transformation toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-1.5 bg-zinc-900/60 p-1 rounded-xl border border-zinc-800/60">
                  <button 
                    type="button" 
                    onClick={() => setRotation(prev => (prev - 90 + 360) % 360)}
                    title="Rotate Left 90°" 
                    className="p-2.5 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-100 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setRotation(prev => (prev + 90) % 360)}
                    title="Rotate Right 90°" 
                    className="p-2.5 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-100 rounded-lg transition-colors"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <div className="h-5 w-[1px] bg-zinc-800 mx-1"></div>
                  <button 
                    type="button" 
                    onClick={() => setFlipH(prev => !prev)}
                    title="Flip Horizontal" 
                    className="p-2.5 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-100 rounded-lg transition-colors"
                  >
                    <FlipHorizontal className="w-4 h-4" />
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setFlipV(prev => !prev)}
                    title="Flip Vertical" 
                    className="p-2.5 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-100 rounded-lg transition-colors"
                  >
                    <FlipVertical className="w-4 h-4" />
                  </button>
                  <div className="h-5 w-[1px] bg-zinc-800 mx-1"></div>
                  <button 
                    type="button" 
                    onClick={resetTransforms}
                    title="Reset Transforms" 
                    className="p-2.5 hover:bg-zinc-850 text-zinc-400 hover:text-red-400 rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                <div>
                  <button 
                    type="button" 
                    onClick={() => setImageBase64(null)}
                    className="px-4 py-2.5 bg-zinc-800/80 hover:bg-zinc-750 text-zinc-200 text-xs font-bold uppercase tracking-wider rounded-xl border border-zinc-750 transition-all"
                  >
                    Swap Image
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Configuration Panel (col-span-5) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div id="generator-config" className="bg-zinc-900/50 border border-zinc-800/80 rounded-[2rem] p-6 shadow-xl flex flex-col gap-5 relative overflow-hidden">
            <div className="flex items-center gap-2 z-10">
              <span className="p-1.5 bg-zinc-800 rounded-lg text-indigo-400 flex items-center justify-center">
                <Sliders className="w-4 h-4" />
              </span>
              <h2 class="text-xs font-bold uppercase tracking-widest text-zinc-400">Generator Configuration</h2>
            </div>

            {/* Prompt Style Selection */}
            <div className="flex flex-col gap-2 z-10">
              <label htmlFor="prompt-style" className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Output Style Tuning</label>
              <select 
                id="prompt-style" 
                value={promptStyle}
                onChange={(e) => setPromptStyle(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded-xl px-4 py-3.5 text-sm text-zinc-200 outline-none cursor-pointer transition-colors"
              >
                <option value="descriptive">Detailed Description (Standard Analysis)</option>
                <option value="recreation">Perfect AI Recreation (Midjourney/DALL-E Prompt)</option>
                <option value="artistic">Artistic & Cinematic Focus (Styles & Moods)</option>
                <option value="minimalist">Minimalist (Short & Punchy Description)</option>
              </select>
            </div>

            {/* Prompt Modifiers presets */}
            <div className="flex flex-col gap-2.5 z-10">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Quick Style Modifiers</span>
                <button 
                  type="button" 
                  onClick={clearModifiers}
                  className="text-[9px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300 font-bold transition-colors"
                >
                  Clear All
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto custom-scrollbar pr-1">
                {modifiers.map((mod) => {
                  const isSelected = selectedModifiers.includes(mod.value);
                  return (
                    <button 
                      key={mod.value}
                      type="button" 
                      onClick={() => toggleModifier(mod.value)}
                      className={`px-2.5 py-1.5 border rounded-lg text-xs font-medium transition-all duration-200 ${
                        isSelected
                          ? 'bg-indigo-950/60 text-indigo-400 border-indigo-500/50 shadow-sm shadow-indigo-900/10'
                          : 'bg-zinc-800/60 border-zinc-800 text-zinc-400 hover:bg-indigo-950/20 hover:text-indigo-400 hover:border-indigo-900/50'
                      }`}
                    >
                      {mod.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Instructions Input */}
            <div className="flex flex-col gap-2 z-10">
              <label htmlFor="custom-instructions" className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Custom Instructions (Optional)</label>
              <textarea 
                id="custom-instructions" 
                rows={3} 
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Specify camera models, film textures, focus details, color palettes..." 
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-zinc-200 outline-none resize-none placeholder-zinc-700 transition-colors"
              />
            </div>

            {/* Generate Button */}
            <button 
              type="button" 
              onClick={generatePrompt}
              disabled={!imageBase64 || isGenerating} 
              className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 border transition-all duration-200 ${
                !imageBase64
                  ? 'bg-zinc-800/40 text-zinc-700 border-zinc-800/60 cursor-not-allowed'
                  : isGenerating
                    ? 'bg-indigo-850 text-indigo-300 border-indigo-750 cursor-wait animate-pulse'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 cursor-pointer shadow-lg shadow-indigo-900/30 hover:scale-[1.01]'
              }`}
            >
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span>{isGenerating ? 'Generating...' : 'Generate Prompt'}</span>
            </button>
          </div>
        </div>

      </div>

      {/* Output Display Container */}
      {(generatedPrompt || isGenerating || errorText) && (
        <div id="output-container" className="bg-zinc-900/50 border border-zinc-800/80 text-zinc-100 rounded-[2.5rem] p-6 sm:p-8 flex flex-col gap-6 shadow-xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/10 via-transparent to-transparent pointer-events-none"></div>
          
          <div className="flex items-center justify-between z-10">
            <div className="flex items-center gap-3">
              <h3 className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">Generated Output</h3>
              <div className={`px-2 py-0.5 border text-[9px] font-bold uppercase tracking-wider rounded-full ${
                isGenerating 
                  ? 'bg-indigo-950 border-indigo-900 text-indigo-400 animate-pulse'
                  : errorText
                    ? 'bg-rose-950 border-rose-900 text-rose-400'
                    : 'bg-emerald-950 border-emerald-900 text-emerald-400'
              }`}>
                {isGenerating ? 'Analyzing...' : errorText ? 'Error' : 'Ready'}
              </div>
            </div>
            
            {generatedPrompt && (
              <div className="flex items-center gap-2 text-zinc-500 text-xs font-mono">
                <span>{generatedPrompt.length} chars</span>
                <span>•</span>
                <span>{generatedPrompt.split(/\s+/).filter(Boolean).length} words</span>
              </div>
            )}
          </div>

          <div className="relative min-h-[100px] flex flex-col z-10 justify-center">
            {isGenerating && (
              <div className="flex flex-col gap-3 justify-center py-4">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-4 h-4 rounded-full bg-indigo-500 animate-spin border-2 border-zinc-950 border-t-transparent"></span>
                  <p className="text-zinc-400 text-xs font-bold tracking-wide uppercase animate-pulse">Gemini is parsing composition, lighting styles & design metaphors...</p>
                </div>
                <div className="h-4 bg-zinc-800/40 rounded-md w-full animate-pulse"></div>
                <div className="h-4 bg-zinc-800/40 rounded-md w-[94%] animate-pulse"></div>
              </div>
            )}

            {errorText && (
              <div className="text-rose-400 text-sm py-2">
                <p className="font-bold">Error:</p>
                <p className="text-zinc-300 mt-0.5">{errorText}</p>
              </div>
            )}

            {generatedPrompt && !isGenerating && (
              <div className="flex-grow flex flex-col lg:flex-row gap-6 items-center justify-between">
                <div className="flex-grow w-full select-text text-left">
                  <p className="text-lg sm:text-xl font-medium leading-relaxed italic tracking-tight text-zinc-100 whitespace-pre-wrap">
                    "{generatedPrompt}"
                  </p>
                </div>

                <div className="flex gap-3 shrink-0 w-full lg:w-auto">
                  <button 
                    type="button" 
                    id="copy-main"
                    onClick={() => handleCopy(generatedPrompt, 'copy-main')}
                    className="flex-grow lg:flex-grow-0 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-8 rounded-2xl flex items-center justify-center gap-3 transition-all hover:scale-[1.02] uppercase text-xs tracking-widest shrink-0 shadow-lg shadow-indigo-950/40"
                  >
                    <Copy className="w-4 h-4" />
                    <span>Copy Prompt</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Prompt History Section */}
      <div id="history-section" className="bg-zinc-900/30 border border-zinc-800/60 rounded-[2rem] p-6 shadow-xl flex flex-col gap-6 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-zinc-800/80 rounded-lg text-indigo-400 flex items-center justify-center">
              <History className="w-4 h-4" />
            </span>
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Your Generation History ({history.length})</h2>
          </div>
          <button 
            type="button" 
            onClick={fetchHistory}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 font-bold uppercase tracking-wider"
          >
            Refresh
          </button>
        </div>

        {loadingHistory ? (
          <div className="flex items-center gap-2 py-8 justify-center text-zinc-500 text-sm">
            <span className="inline-block w-4 h-4 rounded-full bg-zinc-600 animate-spin border-2 border-zinc-950 border-t-transparent"></span>
            <span>Loading history...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-zinc-850 rounded-2xl bg-zinc-900/10">
            <p className="text-zinc-500 text-sm">No prompts generated yet. Your masterpieces will appear here!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto custom-scrollbar pr-1">
            {history.map((item) => (
              <div 
                key={item.id} 
                className="bg-zinc-900/50 border border-zinc-800/50 hover:border-zinc-750 p-5 rounded-2xl flex flex-col justify-between gap-4 transition-all hover:shadow-lg"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 bg-indigo-950/40 text-indigo-400 border border-indigo-900/20 text-[9px] font-bold uppercase tracking-wider rounded-md">
                      {item.promptType}
                    </span>
                    <span className="text-[9px] text-zinc-500 font-mono">
                      {item.createdAt instanceof Timestamp 
                        ? item.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) 
                        : 'Recent'}
                    </span>
                  </div>
                  <p className="text-zinc-300 text-sm italic leading-relaxed line-clamp-3">
                    "{item.prompt}"
                  </p>
                </div>

                <div className="flex items-center justify-between border-t border-zinc-800/60 pt-3">
                  <span className="text-[10px] text-zinc-600 truncate max-w-[180px] font-mono">
                    {item.customInstructions ? 'Has custom parameters' : 'Default config'}
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    <button 
                      type="button" 
                      id={`copy-${item.id}`}
                      onClick={() => handleCopy(item.prompt, `copy-${item.id}`)}
                      className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition-colors"
                      title="Copy Prompt"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </button>
                    <button 
                      type="button" 
                      onClick={() => item.id && deletePromptFromHistory(item.id)}
                      className="p-2 bg-zinc-800 hover:bg-rose-950/40 text-zinc-500 hover:text-rose-400 rounded-lg transition-colors"
                      title="Delete from history"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
