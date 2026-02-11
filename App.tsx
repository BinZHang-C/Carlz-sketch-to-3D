import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';

type RenderMode = 'plan' | 'spatial' | 'enhance';
type Status = 'idle' | 'rendering';
type ImageSize = '1K输出' | '2K输出' | '4K输出';

interface EnhanceParams {
  texture: number;
  smoothing: number;
  detail: number;
  light: number;
}

interface ParsedDataUrl {
  mimeType: string;
  data: string;
}

interface HistoryItem {
  id: number;
  image: string;
  mode: RenderMode;
}

interface StyleFingerprint {
  avgHex: string;
  hue: number;
  saturation: number;
  lightness: number;
  contrast: number;
  warmRatio: number;
}

const buildPlanProtocolPrompt = (blendWeight: number, fingerprint: StyleFingerprint | null): string => {
  const styleCapture = Math.min(99, Math.max(75, Math.round(blendWeight * 0.92 + 7)));
  const styleTelemetry = fingerprint
    ? `Reference telemetry -> avg color: ${fingerprint.avgHex}, hue: ${fingerprint.hue}°, saturation: ${fingerprint.saturation}%, lightness: ${fingerprint.lightness}%, contrast: ${fingerprint.contrast}%, warm ratio: ${fingerprint.warmRatio}%.`
    : 'Reference telemetry unavailable: still prioritize strict colorimetry lock to Image 2.';

  return [
    '[PROTOCOL: PLAN_STYLE_LOCK_V3]',
    'Task: Convert Image 1 architectural lineart/floor plan into a 3D rendered visualization while preserving exact geometry from Image 1.',
    'Instruction priority (strict order):',
    '1) Pixel geometry lock from Image 1. 2) Colorimetry lock from Image 2. 3) Detail enhancement.',
    'Hard geometry constraints:',
    '- Pixel-level geometry lock: keep every wall edge, opening boundary, corner position, and spatial proportion aligned to Image 1 without translation, warping, redesign, or camera-angle drift.',
    '- Keep architectural contour readability and line hierarchy intact. No added structures, no removed structures, no layout hallucination.',
    'Hard style constraints from Image 2 only:',
    '- Use Image 2 as the sole style authority. Never borrow style cues from previous outputs, history thumbnails, or latent memory.',
    '- Match dominant palette family, hue distribution, color gamut boundary, tonal contrast curve, shadow softness, light direction, saturation envelope, and warm/cool balance.',
    '- Keep atmosphere density and brightness interval consistent with Image 2. Avoid random color temperature drift.',
    styleTelemetry,
    `- Style adherence target: ${styleCapture}% (derived from blend weight ${blendWeight}%).`,
    'Stability requirement for repeated runs with identical inputs:',
    '- Low-variance rendering: outputs must remain within a tight tolerance around Image 2 hue/gamut/saturation/light-direction signature.',
    '- If uncertain, prefer conservative reproduction of Image 2 colorimetry; do not invent new tones or cinematic grading.',
    'Rendering guidance:',
    '- Maintain clean architectural visualization quality with stable surfaces and minimal texture noise artifacts.',
  ].join(' ');
};


const defaultEnhanceParams: EnhanceParams = {
  texture: 99,
  smoothing: 10,
  detail: 90,
  light: 70,
};

const parseAspectRatioToCss = (ratio: string): string => {
  if (ratio === '16:9') return '16 / 9';
  if (ratio === '9:16') return '9 / 16';
  if (ratio === '4:3') return '4 / 3';
  if (ratio === '3:4') return '3 / 4';
  return '1 / 1';
};


const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const rgbToHsl = (r: number, g: number, b: number) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return { h, s: clamp01(s), l: clamp01(l) };
};

const analyzeReferenceStyle = (dataUrl: string): Promise<StyleFingerprint> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxSide = 192;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');

        if (!ctx) throw new Error('无法分析参考图风格，请重试。');

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

        let total = 0;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumSat = 0;
        let sumLight = 0;
        let sumHueX = 0;
        let sumHueY = 0;
        let warmCount = 0;
        let minLum = 1;
        let maxLum = 0;

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3] / 255;
          if (alpha < 0.05) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const { h, s, l } = rgbToHsl(r, g, b);
          const hRad = (h * Math.PI) / 180;

          total += 1;
          sumR += r;
          sumG += g;
          sumB += b;
          sumSat += s;
          sumLight += l;
          sumHueX += Math.cos(hRad);
          sumHueY += Math.sin(hRad);
          if (r > b) warmCount += 1;
          minLum = Math.min(minLum, l);
          maxLum = Math.max(maxLum, l);
        }

        if (!total) throw new Error('参考图像像素无效，请更换图片。');

        const avgR = Math.round(sumR / total);
        const avgG = Math.round(sumG / total);
        const avgB = Math.round(sumB / total);
        const avgHue = (Math.atan2(sumHueY / total, sumHueX / total) * 180) / Math.PI;
        const normalizedHue = Math.round(avgHue < 0 ? avgHue + 360 : avgHue);
        const avgSat = Math.round((sumSat / total) * 100);
        const avgLight = Math.round((sumLight / total) * 100);
        const contrast = Math.round((maxLum - minLum) * 100);
        const warmRatio = Math.round((warmCount / total) * 100);
        const avgHex = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;

        resolve({
          avgHex: avgHex.toUpperCase(),
          hue: normalizedHue,
          saturation: avgSat,
          lightness: avgLight,
          contrast,
          warmRatio,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('参考图风格分析失败。'));
      }
    };
    img.onerror = () => reject(new Error('参考图加载失败，请重试。'));
    img.src = dataUrl;
  });

const MAX_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024;
const API_KEY_STORAGE_KEY = 'ARCHI_LOGIC_KEY';
const API_KEY_MIN_LENGTH = 10;

const getStoredApiKey = (): string => {
  try {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  } catch (error) {
    console.warn('Failed to read API key from localStorage', error);
    return '';
  }
};

const saveStoredApiKey = (apiKey: string): void => {
  try {
    window.localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  } catch (error) {
    console.warn('Failed to write API key to localStorage', error);
  }
};

const clearStoredApiKey = (): void => {
  try {
    window.localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to remove API key from localStorage', error);
  }
};

const parseDataUrl = (dataUrl: string): ParsedDataUrl => {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) {
    throw new Error('无效的图像数据格式，请重新上传。');
  }

  return {
    mimeType: match[1],
    data: match[2],
  };
};

const App: React.FC = () => {
  const [renderMode, setRenderMode] = useState<RenderMode>('spatial');
  const [refImage, setRefImage] = useState<string | null>(null);
  const [lineartImage, setLineartImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<Record<RenderMode, HistoryItem[]>>({
    plan: [],
    spatial: [],
    enhance: [],
  });
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [selectedSize, setSelectedSize] = useState<ImageSize>('1K输出');
  const [blendWeight, setBlendWeight] = useState<number>(100);
  const [lineartAspectRatio, setLineartAspectRatio] = useState<string>('1:1');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refStyleFingerprint, setRefStyleFingerprint] = useState<StyleFingerprint | null>(null);

  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [manualApiKey, setManualApiKey] = useState(() => getStoredApiKey());
  const [isEnvKeyActive, setIsEnvKeyActive] = useState(false);

  const [enhanceParams, setEnhanceParams] = useState<EnhanceParams>(defaultEnhanceParams);

  const isEnhance = renderMode === 'enhance';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lineartInputRef = useRef<HTMLInputElement>(null);

  const checkApiStatus = useCallback(async () => {
    const win = window as any;
    let envActive = false;
    try {
      if (win.aistudio && typeof win.aistudio.hasSelectedApiKey === 'function') {
        envActive = await win.aistudio.hasSelectedApiKey();
      } else if (process.env.API_KEY && process.env.API_KEY.length > API_KEY_MIN_LENGTH) {
        envActive = true;
      }
    } catch (error) {
      console.warn('Failed to check AI Studio key status', error);
    }
    setIsEnvKeyActive(envActive);
  }, []);

  useEffect(() => {
    void checkApiStatus();
    const interval = window.setInterval(() => {
      void checkApiStatus();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [checkApiStatus]);

  const handleModeSwitch = (mode: RenderMode) => {
    setRenderMode(mode);
    setRefImage(null);
    setLineartImage(null);
    setResultImage(null);
    setBlendWeight(100);
    setLineartAspectRatio('1:1');
    setEnhanceParams(defaultEnhanceParams);
    setStatus('idle');
    setErrorMessage(null);
    setRefStyleFingerprint(null);
  };

  const getImageAspectRatio = (base64: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.width / img.height;
        if (ratio > 1.5) resolve('16:9');
        else if (ratio < 0.6) resolve('9:16');
        else if (ratio > 1.1) resolve('4:3');
        else if (ratio < 0.9) resolve('3:4');
        else resolve('1:1');
      };
      img.onerror = () => reject(new Error('无法读取图片尺寸，请更换图片重试。'));
      img.src = base64;
    });
  };

  const validateFile = (file: File): string | null => {
    if (!file.type.startsWith('image/')) {
      return '仅支持上传图片文件。';
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return '图片大小不能超过 15MB。';
    }
    return null;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'ref' | 'lineart') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validationError = validateFile(file);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      setErrorMessage('读取图片失败，请重试。');
    };

    reader.onload = async (ev) => {
      try {
        const data = ev.target?.result;
        if (typeof data !== 'string') {
          throw new Error('图片读取结果异常，请重新上传。');
        }

        setErrorMessage(null);
        if (type === 'ref') {
          setRefImage(data);
          const fingerprint = await analyzeReferenceStyle(data);
          setRefStyleFingerprint(fingerprint);
        } else {
          setLineartImage(data);
          const ratio = await getImageAspectRatio(data);
          setLineartAspectRatio(ratio);
        }
        setResultImage(null);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '处理图片失败，请重试。');
      }
    };

    reader.readAsDataURL(file);
  };

  const executeSynthesis = async () => {
    setErrorMessage(null);

    const finalKey = manualApiKey.trim() || process.env.API_KEY || '';

    if (!finalKey || finalKey.length < API_KEY_MIN_LENGTH) {
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
      const ai = new GoogleGenAI({ apiKey: finalKey });
      const apiSize = selectedSize === '4K输出' ? '4K' : selectedSize === '2K输出' ? '2K' : '1K';
      const parts: any[] = [];

      const lineartPart = parseDataUrl(lineartImage);
      parts.push({ inlineData: { data: lineartPart.data, mimeType: lineartPart.mimeType } });

      if (isEnhance) {
        parts.push({
          text: `[PROTOCOL: HD_REMASTER] texture: ${enhanceParams.texture}%, detail: ${enhanceParams.detail}%, light: ${enhanceParams.light}%. Enhance quality while preserving architecture lines.`,
        });
      } else {
        const refPart = parseDataUrl(refImage!);
        parts.push({ inlineData: { data: refPart.data, mimeType: refPart.mimeType } });

        if (renderMode === 'plan') {
          parts.push({
            text: `${buildPlanProtocolPrompt(blendWeight, refStyleFingerprint)} Interpret the above priorities literally and strictly for deterministic style consistency.`,
          });
        } else {
          parts.push({
            text: `[PROTOCOL: SPATIAL_SYNTHESIS] Apply style/materials from Image 2 to the floor plan/CAD structure in Image 1. Blend weight: ${blendWeight}%.`,
          });
        }
      }

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts },
        config: {
          imageConfig: {
            aspectRatio: lineartAspectRatio as any,
            imageSize: apiSize as any,
          },
        },
      });

      const imgPart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!imgPart?.inlineData?.data) {
        throw new Error('模型未返回有效图像，请调整参数后重试。');
      }

      const newResult = `data:${imgPart.inlineData.mimeType || 'image/png'};base64,${imgPart.inlineData.data}`;
      setResultImage(newResult);
      setHistoryItems((prev) => ({
        ...prev,
        [renderMode]: [{ id: Date.now(), image: newResult, mode: renderMode }, ...prev[renderMode]].slice(0, 8),
      }));
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (
        message.includes('Requested entity was not found') ||
        message.includes('billing') ||
        message.includes('403')
      ) {
        const win = window as any;
        if (win.aistudio && typeof win.aistudio.openSelectKey === 'function') {
          await win.aistudio.openSelectKey();
        } else {
          setErrorMessage('Key error: Please ensure your API key has billing enabled.');
          setShowKeyModal(true);
        }
      } else {
        setErrorMessage(`Error: ${message}`);
      }
    } finally {
      setStatus('idle');
    }
  };

  const confirmSaveKey = () => {
    const trimmed = tempApiKey.trim();
    setManualApiKey(trimmed);
    saveStoredApiKey(trimmed);
    setShowKeyModal(false);
    setErrorMessage(null);
  };

  const clearManualKey = () => {
    setTempApiKey('');
    setManualApiKey('');
    clearStoredApiKey();
    setShowKeyModal(false);
  };

  return (
    <div className="h-screen bg-black text-[#666] flex overflow-hidden font-sans select-none relative">
      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-[480px] bg-[#0A0A0A] border border-white/10 p-10 rounded-[3rem] shadow-[0_0_100px_rgba(0,0,0,0.5)] space-y-8 relative">
            <button
              onClick={() => setShowKeyModal(false)}
              className="absolute top-8 right-8 text-white/20 hover:text-white"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="space-y-2">
              <h3 className="text-white text-xl font-black uppercase tracking-tighter italic">API 配置管理</h3>
              <p className="text-[10px] text-white/40 uppercase tracking-widest leading-relaxed">
                请输入您的 Gemini API Key。高级图像合成仅支持已开启结算账户 (Billing) 的付费项目密钥。
                <a
                  href="https://ai.google.dev/gemini-api/docs/billing"
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-500 ml-1 underline"
                >
                  结算文档
                </a>
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
                提示：若您在 AI Studio 内部使用且环境已注入 Key，则无需在此手动设置。手动设置的 Key
                优先级更高且会存储在您的浏览器中。
              </p>
            </div>
          </div>
        </div>
      )}

      {previewImage && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 backdrop-blur-sm p-8">
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-8 right-8 text-white/80 hover:text-white"
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img src={previewImage} className="max-w-[92vw] max-h-[90vh] object-contain rounded-3xl shadow-2xl" />
        </div>
      )}

      {/* Side Navigation */}
      <nav className="w-24 border-r border-white/10 flex flex-col items-center py-10 bg-[#050505] z-50">
        <div
          className="w-14 h-14 bg-white/5 rounded-3xl flex items-center justify-center mb-16 border border-white/10 group cursor-pointer"
          onClick={() => window.location.reload()}
        >
          <div
            className={`w-7 h-7 rounded-sm rotate-45 transition-all duration-700 ${
              isEnhance ? 'bg-amber-500 shadow-[0_0_20px_#f59e0b]' : 'bg-emerald-500 shadow-[0_0_20px_#10b981]'
            }`}
          />
        </div>
        <div className="flex flex-col gap-14 text-white/40">
          {(['spatial', 'enhance', 'plan'] as RenderMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => handleModeSwitch(mode)}
              className={`flex flex-col items-center gap-3 group transition-all ${
                renderMode === mode
                  ? mode === 'enhance'
                    ? 'text-amber-500'
                    : 'text-emerald-500'
                  : 'hover:text-white'
              }`}
            >
              <div
                className={`p-4 rounded-[1.5rem] border-2 transition-all duration-500 ${
                  renderMode === mode
                    ? mode === 'enhance'
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-emerald-500 bg-emerald-500/10'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                {mode === 'spatial' && (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                  </svg>
                )}
                {mode === 'enhance' && (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path d="M15 3l6 6-6 6M9 21l-6-6 6-6" />
                  </svg>
                )}
                {mode === 'plan' && (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 3h18v18H3zM3 9h18M9 3v18" />
                  </svg>
                )}
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
            {(['1K输出', '2K输出', '4K输出'] as ImageSize[]).map((size) => (
              <button
                key={size}
                onClick={() => setSelectedSize(size)}
                className={`px-6 py-2 rounded-full text-[10px] font-black border-2 transition-all ${
                  selectedSize === size ? 'bg-white text-black border-white' : 'border-white/10 text-white/40 hover:text-white'
                }`}
              >
                {size}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-8">
            <div className="flex flex-col items-end">
              <span
                className={`text-[9px] font-black uppercase px-2 py-1 rounded ${
                  manualApiKey || isEnvKeyActive ? 'text-emerald-500 bg-emerald-500/10' : 'text-rose-500 bg-rose-500/10'
                }`}
              >
                {manualApiKey ? 'API: 自定义(就绪)' : isEnvKeyActive ? 'API: 环境注入(就绪)' : 'API: 未绑定'}
              </span>
              <span className="text-[10px] text-white/20 mt-1 uppercase italic">Aspect: {lineartAspectRatio}</span>
            </div>
            <button
              onClick={() => {
                setTempApiKey(manualApiKey);
                setShowKeyModal(true);
              }}
              className={`p-3 rounded-xl border transition-all text-white active:scale-95 ${
                manualApiKey
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-500'
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </button>
          </div>
        </header>

        {!!errorMessage && (
          <div className="mx-10 mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {errorMessage}
          </div>
        )}

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
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="aspect-square bg-[#050505] border-2 border-dashed border-white/10 rounded-[3rem] flex items-center justify-center cursor-pointer hover:border-emerald-500/40 transition-all overflow-hidden relative group"
                    >
                      {refImage ? (
                        <img src={refImage} className="w-full h-full object-cover opacity-80" />
                      ) : (
                        <span className="text-[10px] uppercase opacity-20">导入色彩逻辑图</span>
                      )}
                    </div>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleUpload(e, 'ref')} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-end text-[10px] font-black">
                      <span className="opacity-40">融合权重</span>
                      <span className="text-emerald-500 italic">{blendWeight}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={blendWeight}
                      onChange={(e) => setBlendWeight(parseInt(e.target.value, 10))}
                      className="w-full h-1 bg-white/10 rounded-full appearance-none accent-emerald-500"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-8 p-8 bg-white/5 rounded-[3rem] border border-white/10">
                  <p className="text-[10px] font-black uppercase text-amber-500 italic">Advanced Remastering</p>
                  {[
                    { label: '质感密度', val: enhanceParams.texture, key: 'texture' },
                    { label: '细节补充', val: enhanceParams.detail, key: 'detail' },
                    { label: '光感增强', val: enhanceParams.light, key: 'light' },
                  ].map((p) => (
                    <div key={p.key} className="space-y-2">
                      <div className="flex justify-between text-[10px] font-black uppercase opacity-60">
                        <span>{p.label}</span>
                        <span>{p.val}%</span>
                      </div>
                      <input
                        type="range"
                        value={p.val}
                        onChange={(e) =>
                          setEnhanceParams((prev) => ({ ...prev, [p.key]: parseInt(e.target.value, 10) }))
                        }
                        className="w-full h-1 bg-white/10 rounded-full appearance-none accent-amber-500"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-4">
                <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">02. Geometric Anchor (CAD)</p>
                <div
                  onClick={() => lineartInputRef.current?.click()}
                  className="aspect-video bg-[#050505] border-2 border-dashed border-white/10 rounded-3xl flex items-center justify-center cursor-pointer hover:border-white/30 transition-all overflow-hidden relative"
                >
                  {lineartImage ? (
                    <img src={lineartImage} className="w-full h-full object-cover opacity-80" />
                  ) : (
                    <span className="text-[10px] uppercase opacity-20">导入 CAD 线稿图</span>
                  )}
                </div>
                <input
                  ref={lineartInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => handleUpload(e, 'lineart')}
                />
              </div>
            </div>

            <button
              onClick={executeSynthesis}
              disabled={status === 'rendering'}
              className={`mt-auto w-full py-6 rounded-3xl text-[11px] font-black tracking-[0.4em] uppercase transition-all ${
                status === 'rendering'
                  ? 'bg-white/10 text-white/20 animate-pulse cursor-wait'
                  : 'bg-white text-black hover:scale-[1.02] active:scale-95'
              }`}
            >
              {status === 'rendering' ? 'Synthesis Running...' : 'Start V8 Synthesis'}
            </button>
          </aside>

          {/* Viewport */}
          <main className="flex-1 bg-[#010101] p-16 flex items-center justify-center relative">
            <div className="w-full h-full rounded-[6rem] bg-[#020202] border border-white/10 flex items-center justify-center overflow-hidden relative shadow-2xl">
              {status === 'rendering' ? (
                <div className="flex flex-col items-center gap-6">
                  <div
                    className={`w-16 h-16 border-2 ${
                      isEnhance ? 'border-amber-500' : 'border-emerald-500'
                    } border-t-transparent rounded-full animate-spin`}
                  />
                  <span className="text-[9px] font-black uppercase tracking-[1em] text-white/30">AI Processing...</span>
                </div>
              ) : resultImage ? (
                <div className="group relative w-full h-full flex items-center justify-center p-8 pb-28">
                  <div
                    className="w-full max-w-[72%] max-h-[72%] rounded-[2.5rem] overflow-hidden border border-white/10 bg-black/40"
                    style={{ aspectRatio: parseAspectRatioToCss(lineartAspectRatio) }}
                  >
                    <img
                      src={resultImage}
                      className="w-full h-full object-contain animate-in zoom-in-95 duration-700"
                    />
                  </div>
                  <div className="absolute top-10 right-10 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setPreviewImage(resultImage)}
                      className="px-6 py-3 bg-white text-black text-[10px] font-black uppercase tracking-widest rounded-full shadow-xl"
                    >
                      查看大图
                    </button>
                    <button
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = resultImage;
                        link.download = 'result.png';
                        link.click();
                      }}
                      className="px-6 py-3 bg-white/10 border border-white/20 text-white text-[10px] font-black uppercase tracking-widest rounded-full"
                    >
                      下载
                    </button>
                  </div>
                </div>
              ) : (
                <span className="text-[25rem] font-black italic opacity-[0.02] select-none">V8</span>
              )}
            </div>

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[86%] max-w-5xl rounded-2xl border border-white/10 bg-black/55 backdrop-blur-md px-3 py-2">
              <div className="flex items-center gap-2 overflow-x-auto">
                {historyItems[renderMode].length === 0 ? (
                  <span className="text-[10px] text-white/30 px-3 py-2 uppercase tracking-widest">暂无历史回放</span>
                ) : (
                  historyItems[renderMode].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setResultImage(item.image)}
                      className="shrink-0 w-20 h-14 rounded-lg overflow-hidden border border-white/10 hover:border-emerald-400/60 transition"
                      title="点击回放"
                    >
                      <img src={item.image} className="w-full h-full object-cover" />
                    </button>
                  ))
                )}
              </div>
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
