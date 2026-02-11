
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
  const [hasApiKey, setHasApiKey] = useState(false);
  const [lineartAspectRatio, setLineartAspectRatio] = useState<string>("1:1");

  const [enhanceParams, setEnhanceParams] = useState<EnhanceParams>({
    texture: 99,
    smoothing: 10,
    detail: 90,
    light: 70,
  });

  const isEnhance = renderMode === 'enhance';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lineartInputRef = useRef<HTMLInputElement>(null);

  // 核心：持续同步 API 状态
  const checkApiKeyStatus = async () => {
    const win = window as any;
    if (win.aistudio && typeof win.aistudio.hasSelectedApiKey === 'function') {
      const selected = await win.aistudio.hasSelectedApiKey();
      setHasApiKey(selected);
      return selected;
    }
    return !!process.env.API_KEY;
  };

  useEffect(() => {
    checkApiKeyStatus();
    const interval = setInterval(checkApiKeyStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenKeyPicker = async () => {
    const win = window as any;
    if (win.aistudio && typeof win.aistudio.openSelectKey === 'function') {
      await win.aistudio.openSelectKey();
      setHasApiKey(true);
    } else {
      alert("请确保在 AI Studio 预览环境中使用，并点击右上角钥匙图标。");
    }
  };

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
      if (type === 'ref') {
        setRefImage(data);
      } else {
        setLineartImage(data);
        const ratio = await getImageAspectRatio(data);
        setLineartAspectRatio(ratio);
      }
      setResultImage(null);
    };
    reader.readAsDataURL(file);
  };

  const saveImage = () => {
    if (!resultImage) return;
    const link = document.createElement('a');
    link.href = resultImage;
    link.download = `archi-logic-v8-${Date.now()}.png`;
    link.click();
  };

  const executeSynthesis = async () => {
    if (!lineartImage || status !== 'idle') return;
    if (!isEnhance && !refImage) return;

    // 每次执行前强制检查
    const isReady = await checkApiKeyStatus();
    if (!isReady) {
      alert("未检测到 API 算力。请点击右上角钥匙图标，选择一个关联了已启用结算账户（Billing Enabled）项目的 API Key。");
      handleOpenKeyPicker();
      return;
    }
    
    setStatus('rendering');
    
    try {
      // 必须使用 process.env.API_KEY 以确保调用的是用户在 AI Studio 选择的 Paid Key
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const parts: any[] = [];
      const apiSize = selectedSize === "4K输出" ? "4K" : selectedSize === "2K输出" ? "2K" : "1K";

      if (isEnhance) {
        parts.push({ inlineData: { data: lineartImage.split(',')[1], mimeType: 'image/png' } });
        const enhancePrompt = `
          [TASK: PBR_HD_REMASTER]
          - High-Fidelity Texturing: ${enhanceParams.texture}%
          - Geometric Precision: ${enhanceParams.detail}%
          - Anti-Aliasing Smoothing: ${enhanceParams.smoothing}%
          - GI Illumination Intensity: ${enhanceParams.light}%
          MANDATE: Output ultra-sharp architectural visual while maintaining original CAD topology.
        `;
        parts.push({ text: enhancePrompt });
        
        const response: GenerateContentResponse = await ai.models.generateContent({
          model: 'gemini-3-pro-image-preview',
          contents: { parts: parts },
          config: { imageConfig: { aspectRatio: lineartAspectRatio as any, imageSize: apiSize as any } }
        });

        const imgPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (imgPart?.inlineData) setResultImage(`data:image/png;base64,${imgPart.inlineData.data}`);

      } else {
        parts.push({ inlineData: { data: lineartImage.split(',')[1], mimeType: 'image/png' } });
        parts.push({ inlineData: { data: refImage!.split(',')[1], mimeType: 'image/jpeg' } });
        const renderPrompt = `
          [TASK: ARCHITECTURAL_SYSTHESIS_V8]
          - Layout: CAD Geometry (Image 1)
          - Material DNA: Professional Style (Image 2)
          - Style Infusion Weight: ${blendWeight}%
          - Lighting: Volumetric Global Illumination
          MANDATE: Synthesize professional color plan with absolute fidelity to CAD lines. No warping.
        `;
        parts.push({ text: renderPrompt });

        const response: GenerateContentResponse = await ai.models.generateContent({
          model: 'gemini-3-pro-image-preview',
          contents: { parts: parts },
          config: { imageConfig: { aspectRatio: lineartAspectRatio as any, imageSize: apiSize as any } }
        });

        const imgPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (imgPart?.inlineData) setResultImage(`data:image/png;base64,${imgPart.inlineData.data}`);
      }
    } catch (err: any) {
      console.error("API Call Error:", err);
      if (err.message?.includes("Requested entity was not found") || err.message?.includes("billing")) {
        alert("计费错误：请确保您选择的 API Key 属于一个【已开启结算账户 (Billing Enabled)】的 Google Cloud 项目。免费额度不支持 Gemini 3 Pro 图像生成。");
      } else {
        alert("执行失败：" + (err.message || "未知错误，请检查网络或 Key 有效性"));
      }
    } finally {
      setStatus('idle');
    }
  };

  const renderSlider = (label: string, value: number, onChange: (val: number) => void, colorClass: string) => (
    <div className="space-y-2">
      <div className="flex justify-between items-end">
        <span className="text-[10px] font-black opacity-40 uppercase tracking-widest">{label}</span>
        <span className={`text-xs font-black italic ${colorClass}`}>{value}%</span>
      </div>
      <input 
        type="range" min="0" max="100" value={value} 
        onChange={(e) => onChange(parseInt(e.target.value))} 
        className={`w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-current ${colorClass}`} 
      />
    </div>
  );

  return (
    <div className="h-screen bg-black text-[#666] flex overflow-hidden font-sans select-none relative">
      
      <nav className="w-24 border-r border-white/10 flex flex-col items-center py-10 bg-[#050505] z-50">
        <div className="w-14 h-14 bg-white/5 rounded-3xl flex items-center justify-center mb-16 border border-white/10 group cursor-pointer" onClick={() => window.location.reload()}>
            <div className={`w-7 h-7 rounded-sm rotate-45 transition-all duration-700 ${isEnhance ? 'bg-amber-500 shadow-[0_0_25px_rgba(245,158,11,0.7)]' : 'bg-emerald-500 shadow-[0_0_25px_rgba(16,185,129,0.7)]'}`} />
        </div>
        <div className="flex flex-col gap-14">
          {(['spatial', 'enhance', 'plan'] as RenderMode[]).map(mode => (
            <button key={mode} onClick={() => handleModeSwitch(mode)} className={`flex flex-col items-center gap-3 group transition-all ${renderMode === mode ? (mode === 'enhance' ? 'text-amber-500' : 'text-emerald-500') : 'text-white hover:text-white'}`}>
              <div className={`p-4 rounded-[1.5rem] border-2 transition-all duration-500 ${renderMode === mode ? (mode === 'enhance' ? 'border-amber-500 bg-amber-500/10 shadow-[0_0_30px_rgba(245,158,11,0.2)]' : 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_30px_rgba(16,185,129,0.2)]') : 'border-white/20 bg-white/5 group-hover:border-white/40'}`}>
                {mode === 'spatial' && <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>}
                {mode === 'enhance' && <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M15 3l6 6-6 6M9 21l-6-6 6-6"/></svg>}
                {mode === 'plan' && <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M3 3h18v18H3zM3 9h18M9 3v18"/></svg>}
              </div>
              <span className={`text-[9px] font-black uppercase tracking-[0.2em] transition-opacity ${renderMode === mode ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`}>{mode}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="flex-1 flex flex-col">
        <header className="h-20 flex items-center justify-between px-10 border-b border-white/10 bg-[#020202] shadow-xl relative z-10">
           <div className="flex items-center gap-6">
             {(["1K输出", "2K输出", "4K输出"] as ImageSize[]).map(size => (
               <button key={size} onClick={() => setSelectedSize(size)} className={`px-8 py-2.5 rounded-full text-[10px] font-black border-2 transition-all ${selectedSize === size ? 'bg-white text-black border-white shadow-lg' : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white'}`}>{size}</button>
             ))}
           </div>
           
           <div className="flex items-center gap-10">
             <div className="flex flex-col items-end">
               <span className={`text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-md transition-all duration-500 ${hasApiKey ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                 {hasApiKey ? 'API: 已连接' : 'API: 未绑定'}
               </span>
               <span className="text-[10px] text-white/20 font-bold italic mt-1 uppercase">Topology: {lineartAspectRatio}</span>
             </div>
             
             <button onClick={handleOpenKeyPicker} className="h-12 flex items-center gap-4 px-6 rounded-2xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all shadow-xl active:scale-95 group">
                <span className="text-[10px] font-black uppercase tracking-[0.2em]">API密钥管理</span>
                <svg className="w-5 h-5 text-white/60 group-hover:text-amber-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
             </button>
           </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <aside className="w-[420px] bg-[#030303] p-12 flex flex-col gap-12 border-r border-white/10 overflow-y-auto custom-scrollbar shadow-inner">
            <div className="space-y-3">
              <h2 className="text-white text-3xl font-black tracking-tighter italic uppercase leading-none">Archi-Logic V8</h2>
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${isEnhance ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                <span className="text-[11px] font-black tracking-[0.3em] uppercase text-white/40">Topology Synthesis Alpha</span>
              </div>
            </div>

            <div className="space-y-12">
              {!isEnhance ? (
                <>
                  <div className="space-y-6">
                    <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.3em]">01. Material DNA Source</p>
                    <div onClick={() => fileInputRef.current?.click()} className="aspect-square bg-[#050505] border-2 border-dashed border-white/10 rounded-[3.5rem] flex items-center justify-center cursor-pointer hover:border-emerald-500/40 transition-all overflow-hidden relative group">
                      {refImage ? <img src={refImage} className="w-full h-full object-cover" /> : <div className="flex flex-col items-center gap-3 opacity-20"><svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg><span className="text-[10px] font-black uppercase italic">Import Style</span></div>}
                    </div>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleUpload(e, 'ref')} />
                  </div>
                  {renderSlider("Logic Fusion Weight", blendWeight, setBlendWeight, "text-emerald-500")}
                </>
              ) : (
                <div className="space-y-10">
                  <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.3em]">Precision Remastering</p>
                  <div className="space-y-10 p-10 bg-white/[0.02] border border-white/10 rounded-[4rem]">
                    {renderSlider("渲染质感", enhanceParams.texture, (v) => setEnhanceParams(p => ({...p, texture: v})), "text-amber-500")}
                    {renderSlider("细节深度", enhanceParams.detail, (v) => setEnhanceParams(p => ({...p, detail: v})), "text-amber-500")}
                    {renderSlider("光感调校", enhanceParams.light, (v) => setEnhanceParams(p => ({...p, light: v})), "text-amber-500")}
                  </div>
                </div>
              )}

              <div className="space-y-6">
                <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.3em]">02. Geometric Anchor (CAD)</p>
                <div onClick={() => lineartInputRef.current?.click()} className="aspect-video bg-[#050505] border-2 border-dashed border-white/10 rounded-[3rem] flex items-center justify-center cursor-pointer hover:border-white/30 transition-all overflow-hidden relative group">
                  {lineartImage ? <img src={lineartImage} className="w-full h-full object-cover" /> : <div className="flex flex-col items-center gap-3 opacity-20"><svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg><span className="text-[10px] font-black uppercase italic">Import CAD</span></div>}
                </div>
                <input ref={lineartInputRef} type="file" className="hidden" onChange={(e) => handleUpload(e, 'lineart')} />
              </div>
            </div>

            <button onClick={executeSynthesis} disabled={status === 'rendering' || !lineartImage || (!isEnhance && !refImage)} className={`mt-auto w-full py-8 rounded-[2.5rem] text-[12px] font-black tracking-[0.5em] uppercase transition-all duration-700 ${status === 'rendering' ? 'bg-white/5 text-white/10 animate-pulse' : 'bg-white text-black hover:scale-[1.02] active:scale-95'}`}>
              {status === 'rendering' ? 'Remastering...' : 'Start Rendering'}
            </button>
          </aside>

          <main className="flex-1 bg-[#010101] p-20 flex items-center justify-center relative">
            <div className="w-full h-full rounded-[8rem] bg-[#020202] border border-white/10 flex items-center justify-center overflow-hidden relative shadow-2xl">
              {status === 'rendering' ? (
                <div className="flex flex-col items-center gap-8">
                  <div className={`w-24 h-24 border-4 ${isEnhance ? 'border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)]'} border-t-transparent rounded-full animate-spin`} />
                  <span className="text-[10px] font-black uppercase tracking-[1em] text-white/40">Synthesis In Progress</span>
                </div>
              ) : resultImage ? (
                <div className="group w-full h-full flex items-center justify-center p-16 relative">
                  <img src={resultImage} className="max-w-full max-h-full object-contain rounded-[4rem] shadow-2xl border border-white/10 animate-in fade-in duration-1000" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-700 bg-black/60 backdrop-blur-md rounded-[8rem] pointer-events-none">
                    <button onClick={saveImage} className="pointer-events-auto px-12 py-6 bg-white text-black font-black text-[10px] uppercase tracking-[0.4em] rounded-full hover:scale-110 active:scale-90 transition-all">Download Result</button>
                  </div>
                </div>
              ) : (
                <span className="text-[30rem] font-black italic opacity-[0.02] uppercase select-none">V8</span>
              )}
            </div>
          </main>
        </div>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #222; border-radius: 10px; }
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none; width: 18px; height: 18px; background: white; border-radius: 50%; cursor: pointer; border: 3px solid black;
        }
      `}</style>
    </div>
  );
};

export default App;
