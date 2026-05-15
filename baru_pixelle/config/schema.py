# Copyright (C) 2025 AIDC-AI
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#     http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Configuration schema with Pydantic models

Single source of truth for all configuration defaults and validation.
"""
from typing import Optional
from pydantic import BaseModel, Field


class LLMConfig(BaseModel):
    """LLM configuration"""
    api_key: str = Field(default="", description="LLM API Key")
    base_url: str = Field(default="", description="LLM API Base URL")
    model: str = Field(default="", description="LLM Model Name")


class TTSLocalConfig(BaseModel):
    """Local TTS configuration (Edge TTS)"""
    voice: str = Field(default="zh-CN-YunjianNeural", description="Edge TTS voice ID")
    speed: float = Field(default=1.2, ge=0.5, le=2.0, description="Speech speed multiplier (0.5-2.0)")


class TTSComfyUIConfig(BaseModel):
    """ComfyUI TTS configuration"""
    default_workflow: Optional[str] = Field(default=None, description="Default TTS workflow (optional)")


class TTSSubConfig(BaseModel):
    """TTS-specific configuration (under comfyui.tts)"""
    inference_mode: str = Field(default="local", description="TTS inference mode: 'local' or 'comfyui'")
    local: TTSLocalConfig = Field(default_factory=TTSLocalConfig, description="Local TTS (Edge TTS) configuration")
    comfyui: TTSComfyUIConfig = Field(default_factory=TTSComfyUIConfig, description="ComfyUI TTS configuration")
    
    # Backward compatibility: keep default_workflow at top level
    @property
    def default_workflow(self) -> Optional[str]:
        """Get default workflow (for backward compatibility)"""
        return self.comfyui.default_workflow


class GeminiImageConfig(BaseModel):
    """Gemini image-gen configuration (Nano Banana direct — no ComfyUI needed)."""
    api_key: str = Field(default="", description="Gemini API Key (Google AI Studio)")
    model: str = Field(default="gemini-2.5-flash-image-preview", description="Gemini image model")


class ImagenYohominConfig(BaseModel):
    """Imagen 3 / Nano Banana via Yohomin's /api/imagen/generate proxy.

    Uses sếp's Vertex AI $300 credit pool — no per-user GCP setup needed.
    """
    license_key: str = Field(default="", description="Yohomin license key (Bearer)")
    base_url: str = Field(default="https://yohomin.com", description="Yohomin origin URL")
    aspect_ratio: str = Field(default="9:16", description="One of 1:1, 16:9, 9:16, 4:3, 3:4")


class ImageSubConfig(BaseModel):
    """Image-specific configuration (under comfyui.image)"""
    inference_mode: str = Field(
        default="comfyui",
        description="Image inference mode: 'imagen' | 'gemini' | 'comfyui'",
    )
    imagen: ImagenYohominConfig = Field(
        default_factory=ImagenYohominConfig,
        description="Imagen 3 / Nano Banana via Yohomin proxy (Vertex AI)",
    )
    gemini: GeminiImageConfig = Field(
        default_factory=GeminiImageConfig,
        description="Gemini direct image gen (Nano Banana via AI Studio)",
    )
    default_workflow: Optional[str] = Field(default=None, description="Default image workflow (optional)")
    prompt_prefix: str = Field(
        default="Minimalist black-and-white matchstick figure style illustration, clean lines, simple sketch style",
        description="Prompt prefix for all image generation"
    )


class VideoSubConfig(BaseModel):
    """Video-specific configuration (under comfyui.video)"""
    default_workflow: Optional[str] = Field(default=None, description="Default video workflow (optional)")
    prompt_prefix: str = Field(
        default="Minimalist black-and-white matchstick figure style illustration, clean lines, simple sketch style",
        description="Prompt prefix for all video generation"
    )


class ComfyUIConfig(BaseModel):
    """ComfyUI configuration (includes global settings and service-specific configs)"""
    comfyui_url: str = Field(default="http://127.0.0.1:8188", description="ComfyUI Server URL")
    comfyui_api_key: Optional[str] = Field(default=None, description="ComfyUI API Key (optional)")
    runninghub_api_key: Optional[str] = Field(default=None, description="RunningHub API Key (optional)")
    runninghub_concurrent_limit: int = Field(default=1, ge=1, le=10, description="RunningHub concurrent execution limit (1-10)")
    runninghub_instance_type: Optional[str] = Field(default=None, description="RunningHub instance type (optional, set to 'plus' for 48GB VRAM)")
    tts: TTSSubConfig = Field(default_factory=TTSSubConfig, description="TTS-specific configuration")
    image: ImageSubConfig = Field(default_factory=ImageSubConfig, description="Image-specific configuration")
    video: VideoSubConfig = Field(default_factory=VideoSubConfig, description="Video-specific configuration")


class BrandingConfig(BaseModel):
    """Branding placeholders injected into the HTML template footer.

    Templates declare them as ``{{author=...}}``, ``{{describe=...}}``,
    ``{{brand=...}}``. Empty strings keep the template default (the
    upstream Pixelle.AI signature); set them to whatever sếp wants
    in the video's footer.
    """
    author: str = Field(default="", description="@handle in the footer")
    describe: str = Field(default="", description="One-line description under the author")
    brand: str = Field(default="", description="Brand text in the right corner")


class TemplateConfig(BaseModel):
    """Template configuration"""
    default_template: str = Field(
        default="1080x1920/default.html",
        description="Default frame template path"
    )
    branding: BrandingConfig = Field(
        default_factory=BrandingConfig,
        description="Footer branding (author / describe / brand)",
    )


class PixelleVideoConfig(BaseModel):
    """Pixelle-Video main configuration"""
    project_name: str = Field(default="Pixelle-Video", description="Project name")
    llm: LLMConfig = Field(default_factory=LLMConfig)
    comfyui: ComfyUIConfig = Field(default_factory=ComfyUIConfig)
    template: TemplateConfig = Field(default_factory=TemplateConfig)
    
    def is_llm_configured(self) -> bool:
        """Check if LLM is properly configured"""
        return bool(
            self.llm.api_key and self.llm.api_key.strip() and
            self.llm.base_url and self.llm.base_url.strip() and
            self.llm.model and self.llm.model.strip()
        )
    
    def validate_required(self) -> bool:
        """Validate required configuration"""
        return self.is_llm_configured()
    
    def to_dict(self) -> dict:
        """Convert to dictionary (for backward compatibility)"""
        return self.model_dump()

