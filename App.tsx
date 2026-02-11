
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

type RenderMode = 'plan' | 'spatial' | 'enhance';
type Status = 'idle' | 'rendering';
type ImageSize = "1K输出" | "2K输出" | "4K输出";

interface EnhanceParams {
  texture: number;
  smoothing: number;
  detail: number;
  light: number;
}

const App: React.FC = () => {
  const [renderMode, setRenderMode] = useState<RenderMode>('spatial');
  const [refImage, setRefImage] = useState<string | null>(null);
  const [lineartImage, setLineartImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [selectedSize, setSelectedSize] = useState<ImageSize>("1K输出");
  const [blendWeight, setBlendWeight] = useState<number>(100);
  const [lineartAspectRatio, setLineartAspectRatio] = useState<string>("1:1");
  
  // API 相关状态
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [manualApiKey, setManualApiKey] = useState(() => localStorage.getItem('ARCHI_LOGIC_KEY') || '');
  const [isEnvKeyActive, setIsEnvKeyActive] = useState(false);

  const [enhanceParams, setEnhanceParams] = useState<EnhanceParams>({
    texture: 99,
    smoothing: 10,
    detail: 90,
    light: 70,
  });

  const isEnhance = renderMode === 'enhance';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lineartInputRef = useRef<HTMLInputElement>(null);

  const checkApiStatus = async () => {
    const win = window as any;
    let envActive = false;
    // Follow "API Key Selection" instructions for Veo/Imagen models
    if (win.aistudio && typeof win.aistudio.hasSelectedApiKey === 'function') {
      envActive = await win.aistudio.hasSelectedApiKey();
    } else if (process.env.API_KEY && process.env.API_KEY.length > 10) {
      envActive = true;
    }
    setIsEnvKeyActive(envActive);
  };

  useEffect(() => {
    checkApiStatus();
    const interval = setInterval(checkApiStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleModeSwitch = (mode: RenderMode) => {
    setRenderMode(mode);
    setResultImage(null);
    setStatus('idle');
  };

  const getImageAspectRatio = (base64: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.width / img.height;
        if (ratio > 1.5) resolve("16:9");
        else if (ratio < 0.6) resolve("9:16");
        else if (ratio > 1.1) resolve("4:3");
        else if (ratio < 0.9) resolve("3:4");
        else resolve("1:1");
      };
      img.src = base64;
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'ref' | 'lineart') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const data = ev.target?.result as string;
      if (type === 'ref') setRefImage(data);
      else {
        setLineartImage(data);
        const ratio = await getImageAspectRatio(data);
        setLineartAspectRatio(ratio);
      }
      setResultImage(null);
    };
    reader.readAsDataURL(file);
  };

  const executeSynthesis = async () => {
    // Priority: Manual Key > Env Key
    const finalKey = manualApiKey.trim() || process.env.API_KEY || '';
    
    if (!finalKey || finalKey.length < 10) {
      const win = window as any;
      if (win.aistudio && typeof win.aistudio.openSelectKey === 'function') {
        await win.aistudio.openSelectKey();
        return;
      }
      setTempApiKey(manualApiKey);
      setShowKeyModal(true);
      return;
    }

    if (!lineartImage || status !== 'idle') return;
    if (!isEnhance && !refImage) return;

    setStatus('rendering');
    
    try {
      // Create a new instance right before use to ensure updated key
      const ai = new GoogleGenAI({ apiKey: finalKey });
      const apiSize = selectedSize === "4K输出" ? "4K" : selectedSize === "2K输出" ? "2K" : "1K";
      const parts: any[] = [];

      if (isEnhance) {
        parts.push({ inlineData: { data: lineartImage.split(',')[1], mimeType: 'image/png' } });
        parts.push({ text: `[PROTOCOL: HD_REMASTER] texture: ${enhanceParams.texture}%, detail: ${enhanceParams.detail}%, light: ${enhanceParams.light}%. Enhance quality while preserving architecture lines.` });
      } else {
        parts.push({ inlineData: { data: lineartImage.split(',')[1], mimeType: 'image/png' } });
        parts.push({ inlineData: { data: refImage!.split(',')[1], mimeType: 'image/jpeg' } });
        parts.push({ text: `[PROTOCOL: SPATIAL_SYNTHESIS] Apply style/materials from Image 2 to the floor plan/CAD structure in Image 1. Blend weight: ${blendWeight}%.` });
      }

      // Use generateContent for gemini-3-pro-image-preview
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts: parts },
        config: { 
          imageConfig: { 
            aspectRatio: lineartAspectRatio as any, 
            imageSize: apiSize as any 
          } 
        }
      });

      // Find the image part in response candidates
      const imgPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (imgPart?.inlineData) {
        setResultImage(`data:image/png;base64,${imgPart.inlineData.data}`);
      }
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("Requested entity was not found") || err.message?.includes("billing") || err.message?.includes("403")) {
        const win = window as any;
        if (win.aistudio && typeof win.aistudio.openSelectKey === 'function') {
          await win.aistudio.openSelectKey();
        } else {
          alert("Key error: Please ensure your API key has billing enabled.");
          setShowKeyModal(true);
        }
      } else {
        alert("Error: " + (err.message || "Unknown error"));
      }
    } finally {
      setStatus('idle');
    }
  };

  const confirmSaveKey = () => {
    const trimmed = tempApiKey.trim();
    setManualApiKey(trimmed);
    localStorage.setItem('ARCHI_LOGIC_KEY', trimmed);
    setShowKeyModal(false);
  };

  // Fixed the missing saveManualKey function which caused the error
  const clearManualKey = () => {
    setTempApiKey('');
    setManualApiKey('');
    localStorage.removeItem('ARCHI_LOGIC_KEY');
    setShowKeyModal(false);
  };

  return (
    <div className="h-screen bg-black text-[#666] flex overflow-hidden font-sans select-none relative">
      
      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-[480px] bg-[#0A0A0A] border border-white/10 p-10 rounded-[3rem] shadow-[0_0_100px_rgba(0,0,0,0.5)] space-y-8 relative">
            <button onClick={() => setShowKeyModal(false)} className="absolute top-8 right-8 text-white/20 hover:text-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            
            <div className="space-y-2">
              <h3 className="text-white text-xl font-black uppercase tracking-tighter italic">API 配置管理</h3>
              <p className="text-[10px] text-white/40 uppercase tracking-widest leading-relaxed">
                请输入您的 Gemini API Key。高级图像合成仅支持已开启结算账户 (Billing) 的付费项目密钥。
                <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-amber-500 ml-1 underline">结算文档</a>
              </p>
            </div>

            <div className="space-y-4">
              <input 
                type="password" 
                autoFocus
                value={tempApiKey}
                onChange={(e) => setTempApiKey(e.target.value)}
                placeholder="粘贴您的 API Key"
                className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-amber-500 outline-none transition-all shadow-inner"
              />
              <div className="flex gap-4">
                <button 
                  onClick={confirmSaveKey}
                  className="flex-1 py-4 bg-white text-black text-[11px] font-black uppercase tracking-widest rounded-2xl hover:bg-amber-500 hover:text-white transition-all active:scale-95"
                >
                  确认并保存
                </button>
                <button 
                  onClick={clearManualKey}
                  className="px-6 py-4 bg-white/5 text-rose-500 text-[11px] font-black uppercase tracking-widest rounded-2xl border border-white/10 hover:bg-rose-500/10 transition-all"
                >
                  清除
                </button>
              </div>
            </div>
            
            <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5">
              <p className="text-[9px] text-white/30 italic uppercase leading-normal">
                提示：若您在 AI Studio 内部使用且环境已注入 Key，则无需在此手动设置。手动设置的 Key 优先级更高且会存储在您的浏览器中。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Side Navigation */}
      <nav className="w-24 border-r border-white/10 flex flex-col items-center py-10 bg-[#050505] z-50">
        <div className="w-14 h-14 bg-white/5 rounded-3xl flex items-center justify-center mb-16 border border-white/10 group cursor-pointer" onClick={() => window.location.reload()}>
          <div className={`w-7 h-7 rounded-sm rotate-45 transition-all duration-700 ${isEnhance ? 'bg-amber-500 shadow-[0_0_20px_#f59e0b]' : 'bg-emerald-500 shadow-[0_0_20px_#10b981]'}`} />
        </div>
        <div className="flex flex-col gap-14 text-white/40">
          {(['spatial', 'enhance', 'plan'] as RenderMode[]).map(mode => (
            <button key={mode} onClick={() => handleModeSwitch(mode)} className={`flex flex-col items-center gap-3 group transition-all ${renderMode === mode ? (mode === 'enhance' ? 'text-amber-500' : 'text-emerald-500') : 'hover:text-white'}`}>
              <div className={`p-4 rounded-[1.5rem] border-2 transition-all duration-500 ${renderMode === mode ? (mode === 'enhance' ? 'border-amber-500 bg-amber-500/10' : 'border-emerald-500 bg-emerald-500/10') : 'border-white/10 bg-white/5'}`}>
                {mode === 'spatial' && <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>}
                {mode === 'enhance' && <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M15 3l6 6-6 6M9 21l-6-6 6-6"/></svg>}
                {mode === 'plan' && <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M3 3h18v18H3zM3 9h18M9 3v18"/></svg>}
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest">{mode}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="flex-1 flex flex-col">
        {/* Top Header */}
        <header className="h-20 flex items-center justify-between px-10 border-b border-white/10 bg-[#020202] shadow-xl relative z-10">
           <div className="flex items-center gap-4">
             {(["1K输出", "2K输出", "4K输出"] as ImageSize[]).map(size => (
               <button key={size} onClick={() => setSelectedSize(size)} className={`px-6 py-2 rounded-full text-[10px] font-black border-2 transition-all ${selectedSize === size ? 'bg-white text-black border-white' : 'border-white/10 text-white/40 hover:text-white'}`}>{size}</button>
             ))}
           </div>
           
           <div className="flex items-center gap-8">
             <div className="flex flex-col items-end">
               <span className={`text-[9px] font-black uppercase px-2 py-1 rounded ${manualApiKey || isEnvKeyActive ? 'text-emerald-500 bg-emerald-500/10' : 'text-rose-500 bg-rose-500/10'}`}>
                 {manualApiKey ? 'API: 自定义(就绪)' : isEnvKeyActive ? 'API: 环境注入(就绪)' : 'API: 未绑定'}
               </span>
               <span className="text-[10px] text-white/20 mt-1 uppercase italic">Aspect: {lineartAspectRatio}</span>
             </div>
             <button onClick={() => { setTempApiKey(manualApiKey); setShowKeyModal(true); }} className={`p-3 rounded-xl border transition-all text-white active:scale-95 ${manualApiKey ? 'bg-amber-500/20 border-amber-500/40 text-amber-500' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
               <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
             </button>
           </div>
        </header>

        <div className="flex-1 flex">
          {/* Controls */}
          <aside className="w-[400px] bg-[#030303] p-10 flex flex-col gap-10 border-r border-white/10 overflow-y-auto">
            <div className="space-y-2">
              <h2 className="text-white text-2xl font-black italic tracking-tighter uppercase">Archi-Logic V8</h2>
              <p className="text-[10px] font-black tracking-[0.3em] uppercase opacity-30">Topology Synthesis Alpha</p>
            </div>

            <div className="space-y-10">
              {!isEnhance ? (
                <>
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">01. Material DNA Source</p>
                    <div onClick={() => fileInputRef.current?.click()} className="aspect-square bg-[#050505] border-2 border-dashed border-white/10 rounded-[3rem] flex items-center justify-center cursor-pointer hover:border-emerald-500/40 transition-all overflow-hidden relative group">
                      {refImage ? <img src={refImage} className="w-full h-full object-cover opacity-80" /> : <span className="text-[10px] uppercase opacity-20">导入色彩逻辑图</span>}
                    </div>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleUpload(e, 'ref')} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-end text-[10px] font-black"><span className="opacity-40">融合权重</span><span className="text-emerald-500 italic">{blendWeight}%</span></div>
                    <input type="range" min="0" max="100" value={blendWeight} onChange={(e) => setBlendWeight(parseInt(e.target.value))} className="w-full h-1 bg-white/10 rounded-full appearance-none accent-emerald-500" />
                  </div>
                </>
              ) : (
                <div className="space-y-8 p-8 bg-white/5 rounded-[3rem] border border-white/10">
                  <p className="text-[10px] font-black uppercase text-amber-500 italic">Advanced Remastering</p>
                  {[ 
                    { label: '质感密度', val: enhanceParams.texture, key: 'texture' },
                    { label: '细节补充', val: enhanceParams.detail, key: 'detail' },
                    { label: '光感增强', val: enhanceParams.light, key: 'light' }
                  ].map(p => (
                    <div key={p.key} className="space-y-2">
                      <div className="flex justify-between text-[10px] font-black uppercase opacity-60"><span>{p.label}</span><span>{p.val}%</span></div>
                      <input type="range" value={p.val} onChange={(e) => setEnhanceParams(prev => ({...prev, [p.key]: parseInt(e.target.value)}))} className="w-full h-1 bg-white/10 rounded-full appearance-none accent-amber-500" />
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-4">
                <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">02. Geometric Anchor (CAD)</p>
                <div onClick={() => lineartInputRef.current?.click()} className="aspect-video bg-[#050505] border-2 border-dashed border-white/10 rounded-3xl flex items-center justify-center cursor-pointer hover:border-white/30 transition-all overflow-hidden relative">
                  {lineartImage ? <img src={lineartImage} className="w-full h-full object-cover opacity-80" /> : <span className="text-[10px] uppercase opacity-20">导入 CAD 线稿图</span>}
                </div>
                <input ref={lineartInputRef} type="file" className="hidden" onChange={(e) => handleUpload(e, 'lineart')} />
              </div>
            </div>

            <button 
              onClick={executeSynthesis} 
              disabled={status === 'rendering'} 
              className={`mt-auto w-full py-6 rounded-3xl text-[11px] font-black tracking-[0.4em] uppercase transition-all ${status === 'rendering' ? 'bg-white/10 text-white/20 animate-pulse cursor-wait' : 'bg-white text-black hover:scale-[1.02] active:scale-95'}`}
            >
              {status === 'rendering' ? 'Synthesis Running...' : 'Start V8 Synthesis'}
            </button>
          </aside>

          {/* Viewport */}
          <main className="flex-1 bg-[#010101] p-16 flex items-center justify-center relative">
            <div className="w-full h-full rounded-[6rem] bg-[#020202] border border-white/10 flex items-center justify-center overflow-hidden relative shadow-2xl">
              {status === 'rendering' ? (
                <div className="flex flex-col items-center gap-6">
                  <div className={`w-16 h-16 border-2 ${isEnhance ? 'border-amber-500' : 'border-emerald-500'} border-t-transparent rounded-full animate-spin`} />
                  <span className="text-[9px] font-black uppercase tracking-[1em] text-white/30">AI Processing...</span>
                </div>
              ) : resultImage ? (
                <div className="group relative w-full h-full flex items-center justify-center p-12">
                  <img src={resultImage} className="max-w-full max-h-full object-contain rounded-[3rem] shadow-2xl animate-in zoom-in-95 duration-700" />
                  <button onClick={() => { const link = document.createElement('a'); link.href = resultImage; link.download = 'result.png'; link.click(); }} className="absolute inset-0 m-auto w-fit h-fit px-10 py-5 bg-white text-black text-[10px] font-black uppercase tracking-widest rounded-full opacity-0 group-hover:opacity-100 transition-all transform translate-y-4 group-hover:translate-y-0 shadow-2xl pointer-events-auto">Download Result</button>
                </div>
              ) : (
                <span className="text-[25rem] font-black italic opacity-[0.02] select-none">V8</span>
              )}
            </div>
          </main>
        </div>
      </div>

      <style>{`
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 10px; }
        input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; background: white; border-radius: 50%; cursor: pointer; border: 2px solid black; }
      `}</style>
    </div>
  );
};

export default App;
