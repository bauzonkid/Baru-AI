import { useEffect, useState } from "react";
import { getConfig, saveConfig, type AppConfig, type ImageMode } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; config: AppConfig }
  | { kind: "error"; message: string };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function SettingsModal({ open, onClose }: Props) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  // Form fields
  const [llmKey, setLlmKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [imageMode, setImageMode] = useState<ImageMode>("imagen");
  const [imagenLicense, setImagenLicense] = useState("");
  const [imagenBaseUrl, setImagenBaseUrl] = useState("https://yohomin.com");
  const [imagenAspect, setImagenAspect] = useState("9:16");
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("");
  const [ttsVoice, setTtsVoice] = useState("");
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [promptPrefix, setPromptPrefix] = useState("");
  const [brandAuthor, setBrandAuthor] = useState("");
  const [brandDescribe, setBrandDescribe] = useState("");
  const [brandBrand, setBrandBrand] = useState("");

  // Load config every time the modal opens — keeps the form fresh if
  // the user edits config.yaml externally.
  useEffect(() => {
    if (!open) return;
    setLoadState({ kind: "loading" });
    setSaveState({ kind: "idle" });
    getConfig()
      .then((cfg) => {
        setLoadState({ kind: "loaded", config: cfg });
        setLlmKey(cfg.llm?.api_key ?? "");
        setLlmBaseUrl(cfg.llm?.base_url ?? "");
        setLlmModel(cfg.llm?.model ?? "");
        const img = cfg.comfyui?.image;
        setImageMode((img?.inference_mode as ImageMode) ?? "imagen");
        setImagenLicense(img?.imagen?.license_key ?? "");
        setImagenBaseUrl(img?.imagen?.base_url ?? "https://yohomin.com");
        setImagenAspect(img?.imagen?.aspect_ratio ?? "9:16");
        setGeminiKey(img?.gemini?.api_key ?? "");
        setGeminiModel(img?.gemini?.model ?? "gemini-2.5-flash-image-preview");
        setPromptPrefix(img?.prompt_prefix ?? "");
        const tts = cfg.comfyui?.tts;
        setTtsVoice(tts?.local?.voice ?? "en-US-AriaNeural");
        setTtsSpeed(tts?.local?.speed ?? 1.0);
        const brand = cfg.template?.branding;
        setBrandAuthor(brand?.author ?? "");
        setBrandDescribe(brand?.describe ?? "");
        setBrandBrand(brand?.brand ?? "");
      })
      .catch((err) => {
        setLoadState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, [open]);

  async function onSave() {
    setSaveState({ kind: "saving" });
    try {
      await saveConfig({
        llm: {
          api_key: llmKey,
          base_url: llmBaseUrl,
          model: llmModel,
        },
        comfyui: {
          image: {
            inference_mode: imageMode,
            imagen: {
              license_key: imagenLicense,
              base_url: imagenBaseUrl,
              aspect_ratio: imagenAspect,
            },
            gemini: {
              api_key: geminiKey,
              model: geminiModel,
            },
            prompt_prefix: promptPrefix,
          },
          tts: {
            local: {
              voice: ttsVoice,
              speed: ttsSpeed,
            },
          },
        },
        template: {
          branding: {
            author: brandAuthor,
            describe: brandDescribe,
            brand: brandBrand,
          },
        },
      });
      setSaveState({ kind: "saved" });
      window.setTimeout(() => setSaveState({ kind: "idle" }), 2000);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || (err instanceof Error ? err.message : String(err));
      setSaveState({ kind: "error", message: detail });
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded border border-neutral-800 bg-neutral-950 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-100">Cấu hình</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-neutral-500 hover:text-neutral-200"
          >
            Đóng
          </button>
        </header>

        {loadState.kind === "loading" ? (
          <div className="py-8 text-center text-sm text-neutral-500">
            Đang tải cấu hình...
          </div>
        ) : loadState.kind === "error" ? (
          <div className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">
            Không load được config: {loadState.message}
          </div>
        ) : loadState.kind === "loaded" ? (
          <div className="space-y-6">
            <SectionLLM
              apiKey={llmKey}
              baseUrl={llmBaseUrl}
              model={llmModel}
              onApiKey={setLlmKey}
              onBaseUrl={setLlmBaseUrl}
              onModel={setLlmModel}
            />

            <SectionImage
              mode={imageMode}
              imagenLicense={imagenLicense}
              imagenBaseUrl={imagenBaseUrl}
              imagenAspect={imagenAspect}
              geminiKey={geminiKey}
              geminiModel={geminiModel}
              promptPrefix={promptPrefix}
              onMode={setImageMode}
              onImagenLicense={setImagenLicense}
              onImagenBaseUrl={setImagenBaseUrl}
              onImagenAspect={setImagenAspect}
              onGeminiKey={setGeminiKey}
              onGeminiModel={setGeminiModel}
              onPromptPrefix={setPromptPrefix}
            />

            <SectionTTS
              voice={ttsVoice}
              speed={ttsSpeed}
              onVoice={setTtsVoice}
              onSpeed={setTtsSpeed}
            />

            <SectionBranding
              author={brandAuthor}
              describe={brandDescribe}
              brand={brandBrand}
              onAuthor={setBrandAuthor}
              onDescribe={setBrandDescribe}
              onBrand={setBrandBrand}
            />

            <footer className="flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
              {saveState.kind === "saved" ? (
                <span className="text-xs text-emerald-400">Đã lưu</span>
              ) : saveState.kind === "error" ? (
                <span
                  className="text-xs text-red-400 max-w-md truncate"
                  title={saveState.message}
                >
                  Lỗi: {saveState.message}
                </span>
              ) : null}
              <button
                type="button"
                onClick={onSave}
                disabled={saveState.kind === "saving"}
                className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-emerald-50 hover:bg-emerald-600 disabled:opacity-50"
              >
                {saveState.kind === "saving" ? "Đang lưu..." : "Lưu"}
              </button>
            </footer>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2">
        <h3 className="text-sm font-medium text-neutral-200">{title}</h3>
        {hint ? <p className="mt-0.5 text-[11px] text-neutral-500">{hint}</p> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
    />
  );
}

const LLM_PRESETS: Array<{
  id: string;
  label: string;
  base_url: string;
  model: string;
  key_placeholder: string;
}> = [
  {
    id: "9router-cloud",
    label: "9router (Yohomin cloud)",
    base_url: "https://yohomin.com/v1",
    model: "gemini-2.5-flash",
    key_placeholder: "sk-yohomin-9router-bypass",
  },
  {
    id: "9router-local",
    label: "9router (local proxy)",
    base_url: "http://localhost:20128/v1",
    model: "gemini-2.5-flash",
    key_placeholder: "sk-yohomin-9router-bypass",
  },
  {
    id: "gemini-direct",
    label: "Gemini direct (AI Studio)",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
    model: "gemini-2.5-flash",
    key_placeholder: "AIza... (Google AI Studio key)",
  },
  {
    id: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    key_placeholder: "sk-...",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    base_url: "https://api.deepseek.com",
    model: "deepseek-chat",
    key_placeholder: "sk-...",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    base_url: "http://localhost:11434/v1",
    model: "llama3.2",
    key_placeholder: "(không cần)",
  },
];

function detectPreset(baseUrl: string): string {
  const found = LLM_PRESETS.find((p) => p.base_url === baseUrl);
  return found?.id ?? "custom";
}

function SectionLLM({
  apiKey,
  baseUrl,
  model,
  onApiKey,
  onBaseUrl,
  onModel,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  onApiKey: (v: string) => void;
  onBaseUrl: (v: string) => void;
  onModel: (v: string) => void;
}) {
  const presetId = detectPreset(baseUrl);
  const preset = LLM_PRESETS.find((p) => p.id === presetId);

  function onPresetChange(id: string) {
    const p = LLM_PRESETS.find((x) => x.id === id);
    if (!p) return; // "custom" — keep current values
    onBaseUrl(p.base_url);
    onModel(p.model);
  }

  return (
    <Section
      title="LLM"
      hint="OpenAI-compat endpoint. 9router (Yohomin) là default — multi-account Gemini rotation."
    >
      <Field label="Preset">
        <Select
          value={presetId}
          onChange={(e) => onPresetChange(e.target.value)}
        >
          {LLM_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Tuỳ chỉnh</option>
        </Select>
      </Field>
      <Field label="API Key">
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => onApiKey(e.target.value)}
          placeholder={preset?.key_placeholder ?? "API key"}
        />
      </Field>
      <Field label="Base URL">
        <Input
          type="text"
          value={baseUrl}
          onChange={(e) => onBaseUrl(e.target.value)}
          placeholder="https://..."
        />
      </Field>
      <Field label="Model">
        <Input
          type="text"
          value={model}
          onChange={(e) => onModel(e.target.value)}
          placeholder="gemini-2.5-flash"
        />
      </Field>
    </Section>
  );
}

const ASPECT_OPTIONS = [
  { value: "9:16", label: "9:16 — Dọc (Shorts/Reels/TikTok)" },
  { value: "1:1", label: "1:1 — Vuông" },
  { value: "16:9", label: "16:9 — Ngang (YouTube)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];

function SectionImage({
  mode,
  imagenLicense,
  imagenBaseUrl,
  imagenAspect,
  geminiKey,
  geminiModel,
  promptPrefix,
  onMode,
  onImagenLicense,
  onImagenBaseUrl,
  onImagenAspect,
  onGeminiKey,
  onGeminiModel,
  onPromptPrefix,
}: {
  mode: ImageMode;
  imagenLicense: string;
  imagenBaseUrl: string;
  imagenAspect: string;
  geminiKey: string;
  geminiModel: string;
  promptPrefix: string;
  onMode: (v: ImageMode) => void;
  onImagenLicense: (v: string) => void;
  onImagenBaseUrl: (v: string) => void;
  onImagenAspect: (v: string) => void;
  onGeminiKey: (v: string) => void;
  onGeminiModel: (v: string) => void;
  onPromptPrefix: (v: string) => void;
}) {
  return (
    <Section
      title="Image gen"
      hint="Imagen = Vertex AI qua Yohomin (sếp's $300 credit). Gemini direct = AI Studio free tier. ComfyUI = workflow advanced."
    >
      <Field label="Mode">
        <Select
          value={mode}
          onChange={(e) => onMode(e.target.value as ImageMode)}
        >
          <option value="imagen">Imagen 3 (Yohomin / Vertex AI)</option>
          <option value="gemini">Gemini direct (Nano Banana)</option>
          <option value="comfyui">ComfyUI workflow</option>
        </Select>
      </Field>

      {mode === "imagen" ? (
        <>
          <Field label="Yohomin license key">
            <Input
              type="password"
              value={imagenLicense}
              onChange={(e) => onImagenLicense(e.target.value)}
              placeholder="License key (auto-fill khi sếp đăng nhập, có thể để trống)"
            />
          </Field>
          <Field label="Yohomin base URL">
            <Input
              type="text"
              value={imagenBaseUrl}
              onChange={(e) => onImagenBaseUrl(e.target.value)}
              placeholder="https://yohomin.com"
            />
          </Field>
          <Field label="Tỉ lệ ảnh">
            <Select
              value={imagenAspect}
              onChange={(e) => onImagenAspect(e.target.value)}
            >
              {ASPECT_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="mt-2 rounded-baru-md border border-baru-edge bg-baru-panel-2 p-3">
            <div className="text-label-xs uppercase text-baru-muted mb-2">
              Fallback khi Imagen hết quota
            </div>
            <p className="mb-2 text-[11px] text-baru-dim">
              Vertex AI Imagen có quota daily. Nếu hết, app tự chuyển
              sang Gemini Nano Banana (AI Studio free tier ~100/ngày).
              Dán key Google AI Studio dưới đây để bật fallback.
            </p>
            <Field label="Gemini API Key (fallback)">
              <Input
                type="password"
                value={geminiKey}
                onChange={(e) => onGeminiKey(e.target.value)}
                placeholder="AIza... (cùng key Google AI Studio với LLM cũng được)"
              />
            </Field>
          </div>
        </>
      ) : null}

      {mode === "gemini" ? (
        <>
          <Field label="Gemini API Key">
            <Input
              type="password"
              value={geminiKey}
              onChange={(e) => onGeminiKey(e.target.value)}
              placeholder="AIza... (cùng key Google AI Studio với LLM cũng được)"
            />
          </Field>
          <Field label="Model">
            <Input
              type="text"
              value={geminiModel}
              onChange={(e) => onGeminiModel(e.target.value)}
              placeholder="gemini-2.5-flash-image-preview"
            />
          </Field>
        </>
      ) : null}

      <Field label="Prompt prefix (style)">
        <Input
          type="text"
          value={promptPrefix}
          onChange={(e) => onPromptPrefix(e.target.value)}
          placeholder="Minimalist illustration, clean lines, vibrant colors"
        />
      </Field>
    </Section>
  );
}

function SectionTTS({
  voice,
  speed,
  onVoice,
  onSpeed,
}: {
  voice: string;
  speed: number;
  onVoice: (v: string) => void;
  onSpeed: (v: number) => void;
}) {
  return (
    <Section
      title="Text-to-Speech"
      hint="Edge TTS local (free, không cần key). Voice ID xem learn.microsoft.com/azure/ai-services/speech-service/language-support."
    >
      <Field label="Voice ID">
        <Input
          type="text"
          value={voice}
          onChange={(e) => onVoice(e.target.value)}
          placeholder="en-US-AriaNeural / vi-VN-HoaiMyNeural / ..."
        />
      </Field>
      <Field label={`Speed: ${speed.toFixed(2)}x`}>
        <input
          type="range"
          min={0.5}
          max={2.0}
          step={0.05}
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
          className="accent-emerald-500"
        />
      </Field>
    </Section>
  );
}

function SectionBranding({
  author,
  describe,
  brand,
  onAuthor,
  onDescribe,
  onBrand,
}: {
  author: string;
  describe: string;
  brand: string;
  onAuthor: (v: string) => void;
  onDescribe: (v: string) => void;
  onBrand: (v: string) => void;
}) {
  return (
    <Section
      title="Thương hiệu (footer video)"
      hint="Thay 3 dòng @Pixelle.AI / Open Source Omnimodal AI Creative Agent / Pixelle-Video ở cuối video. Để trống = giữ mặc định của template."
    >
      <Field label="Tên kênh (góc dưới trái)">
        <Input
          type="text"
          value={author}
          onChange={(e) => onAuthor(e.target.value)}
          placeholder="VD: @yohomin hoặc tên kênh YouTube"
        />
      </Field>
      <Field label="Mô tả (dòng phụ)">
        <Input
          type="text"
          value={describe}
          onChange={(e) => onDescribe(e.target.value)}
          placeholder="VD: AI Video Studio (để trống = ẩn)"
        />
      </Field>
      <Field label="Brand (góc dưới phải)">
        <Input
          type="text"
          value={brand}
          onChange={(e) => onBrand(e.target.value)}
          placeholder="VD: Baru-Pixelle hoặc tên brand riêng"
        />
      </Field>
    </Section>
  );
}
