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
Media Generation Service - ComfyUI Workflow-based implementation

Supports both image and video generation workflows.
Automatically detects output type based on ExecuteResult.
"""

import json
import os
from typing import Optional, Set

from comfykit import ComfyKit
from loguru import logger

from baru_ai.services.comfy_base_service import ComfyBaseService
from baru_ai.services.gemini_image import generate_image_gemini, DEFAULT_MODEL as GEMINI_DEFAULT_MODEL
from baru_ai.services.imagen_yohomin import generate_image_imagen, ImagenQuotaExceeded
from baru_ai.models.media import MediaResult


def _workflow_input_tags(workflow_path: str) -> Set[str]:
    """Scan a workflow JSON for Pixelle $template title tags.

    Returns the set of param names referenced (e.g. {"image", "audio",
    "prompt"}). Used to detect when a video workflow needs a generated
    image fed in before execution.

    Robust to missing file / parse errors — returns empty set rather
    than raising, so a bad workflow file degrades to "no auto image
    generation" instead of breaking the whole pipeline.
    """
    try:
        with open(workflow_path, "r", encoding="utf-8") as f:
            wf = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning(f"Could not scan workflow tags from {workflow_path}: {exc}")
        return set()

    tags: Set[str] = set()
    nodes = wf.values() if isinstance(wf, dict) else []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        title = (node.get("_meta") or {}).get("title", "")
        # Pixelle pattern: $<param>.<widget> or $<param>.<widget>!
        if isinstance(title, str) and title.startswith("$") and "." in title:
            name = title[1:].split(".", 1)[0]
            tags.add(name)
    return tags


class MediaService(ComfyBaseService):
    """
    Media generation service - Workflow-based
    
    Uses ComfyKit to execute image/video generation workflows.
    Supports both image_ and video_ workflow prefixes.
    
    Usage:
        # Use default workflow (workflows/image_flux.json)
        media = await baru_ai.media(prompt="a cat")
        if media.is_image:
            print(f"Generated image: {media.url}")
        elif media.is_video:
            print(f"Generated video: {media.url} ({media.duration}s)")
        
        # Use specific workflow
        media = await baru_ai.media(
            prompt="a cat",
            workflow="image_flux.json"
        )
        
        # List available workflows
        workflows = baru_ai.media.list_workflows()
    """
    
    WORKFLOW_PREFIX = ""  # Will be overridden by _scan_workflows
    DEFAULT_WORKFLOW = None  # No hardcoded default, must be configured
    WORKFLOWS_DIR = "workflows"
    
    def __init__(self, config: dict, core=None):
        """
        Initialize media service
        
        Args:
            config: Full application config dict
            core: PixelleVideoCore instance (for accessing shared ComfyKit)
        """
        super().__init__(config, service_name="image", core=core)  # Keep "image" for config compatibility
    
    def _scan_workflows(self):
        """
        Scan workflows for both image_ and video_ prefixes
        
        Override parent method to support multiple prefixes
        """
        from baru_ai.utils.os_util import list_resource_dirs, list_resource_files, get_resource_path
        from pathlib import Path
        
        workflows = []
        
        # Get all workflow source directories
        source_dirs = list_resource_dirs("workflows")
        
        if not source_dirs:
            logger.warning("No workflow source directories found")
            return workflows
        
        # Scan each source directory for workflow files
        for source_name in source_dirs:
            # Get all JSON files for this source
            workflow_files = list_resource_files("workflows", source_name)
            
            # Filter to only files matching image_ or video_ prefix
            matching_files = [
                f for f in workflow_files 
                if (f.startswith("image_") or f.startswith("video_")) and f.endswith('.json')
            ]
            
            for filename in matching_files:
                try:
                    # Get actual file path
                    file_path = Path(get_resource_path("workflows", source_name, filename))
                    workflow_info = self._parse_workflow_file(file_path, source_name)
                    workflows.append(workflow_info)
                    logger.debug(f"Found workflow: {workflow_info['key']}")
                except Exception as e:
                    logger.error(f"Failed to parse workflow {source_name}/{filename}: {e}")
        
        # Sort by key (source/name)
        return sorted(workflows, key=lambda w: w["key"])
    
    async def __call__(
        self,
        prompt: str,
        workflow: Optional[str] = None,
        # Media type specification (required for proper handling)
        media_type: str = "image",  # "image" or "video"
        # ComfyUI connection (optional overrides)
        comfyui_url: Optional[str] = None,
        runninghub_api_key: Optional[str] = None,
        # Inference mode override (param > config["inference_mode"] > "comfyui")
        inference_mode: Optional[str] = None,
        # Output path (Gemini direct mode only â€” workflow modes save where ComfyKit saves)
        output_path: Optional[str] = None,
        # Common workflow parameters
        width: Optional[int] = None,
        height: Optional[int] = None,
        duration: Optional[float] = None,  # Video duration in seconds (for video workflows)
        negative_prompt: Optional[str] = None,
        steps: Optional[int] = None,
        seed: Optional[int] = None,
        cfg: Optional[float] = None,
        sampler: Optional[str] = None,
        **params
    ) -> MediaResult:
        """
        Generate media (image or video) using workflow
        
        Media type must be specified explicitly via media_type parameter.
        Returns a MediaResult object containing media type and URL.
        
        Args:
            prompt: Media generation prompt
            workflow: Workflow filename (default: from config or "image_flux.json")
            media_type: Type of media to generate - "image" or "video" (default: "image")
            comfyui_url: ComfyUI URL (optional, overrides config)
            runninghub_api_key: RunningHub API key (optional, overrides config)
            width: Media width
            height: Media height
            duration: Target video duration in seconds (only for video workflows, typically from TTS audio duration)
            negative_prompt: Negative prompt
            steps: Sampling steps
            seed: Random seed
            cfg: CFG scale
            sampler: Sampler name
            **params: Additional workflow parameters
        
        Returns:
            MediaResult object with media_type ("image" or "video") and url
        
        Examples:
            # Simplest: use default workflow (workflows/image_flux.json)
            media = await baru_ai.media(prompt="a beautiful cat")
            if media.is_image:
                print(f"Image: {media.url}")
            
            # Use specific workflow
            media = await baru_ai.media(
                prompt="a cat",
                workflow="image_flux.json"
            )
            
            # Video workflow
            media = await baru_ai.media(
                prompt="a cat running",
                workflow="image_video.json"
            )
            if media.is_video:
                print(f"Video: {media.url}, duration: {media.duration}s")
            
            # With additional parameters
            media = await baru_ai.media(
                prompt="a cat",
                workflow="image_flux.json",
                width=1024,
                height=1024,
                steps=20,
                seed=42
            )
            
            # With absolute path
            media = await baru_ai.media(
                prompt="a cat",
                workflow="/path/to/custom.json"
            )
            
            # With custom ComfyUI server
            media = await baru_ai.media(
                prompt="a cat",
                comfyui_url="http://192.168.1.100:8188"
            )
        """
        # Inference mode: param > config > default "comfyui". Video gen never
        # routes outside ComfyUI â€” only image gen has alternate backends.
        mode = inference_mode or self.config.get("inference_mode", "comfyui")
        if media_type == "image" and mode == "imagen":
            imagen_cfg = self.config.get("imagen", {}) or {}
            license_key = imagen_cfg.get("license_key") or os.environ.get("BARU_LICENSE_KEY", "")
            try:
                return await generate_image_imagen(
                    prompt=prompt,
                    license_key=license_key,
                    base_url=imagen_cfg.get("base_url") or "https://yohomin.com",
                    aspect_ratio=imagen_cfg.get("aspect_ratio") or "9:16",
                    output_path=output_path,
                )
            except ImagenQuotaExceeded as exc:
                # Vertex daily quota burned. Fall back to Nano Banana via
                # AI Studio (free tier ~100/day, separate quota pool) if
                # the user provided an AI Studio key. Otherwise re-raise
                # so the user sees the quota message + can switch tomorrow.
                gemini_cfg = self.config.get("gemini", {}) or {}
                fallback_key = gemini_cfg.get("api_key") or os.environ.get("GEMINI_API_KEY", "")
                if not fallback_key:
                    logger.error(
                        "Imagen quota exhausted and no Gemini AI Studio "
                        "key configured for fallback. Paste a key into "
                        "Settings â†’ Image gen â†’ Gemini API Key to enable "
                        "automatic fallback next time."
                    )
                    raise
                logger.warning(
                    f"Imagen quota exhausted: {exc}. Falling back to "
                    f"Gemini direct (Nano Banana via AI Studio)."
                )
                return await generate_image_gemini(
                    prompt=prompt,
                    api_key=fallback_key,
                    model=gemini_cfg.get("model") or GEMINI_DEFAULT_MODEL,
                    output_path=output_path,
                )
        if media_type == "image" and mode == "gemini":
            gemini_cfg = self.config.get("gemini", {}) or {}
            api_key = gemini_cfg.get("api_key") or os.environ.get("GEMINI_API_KEY", "")
            model = gemini_cfg.get("model") or GEMINI_DEFAULT_MODEL
            return await generate_image_gemini(
                prompt=prompt,
                api_key=api_key,
                model=model,
                output_path=output_path,
            )

        # 1. Resolve workflow (returns structured info)
        workflow_info = self._resolve_workflow(workflow=workflow)
        
        # 2. Build workflow parameters (ComfyKit config is now managed by core)
        workflow_params = {"prompt": prompt}
        
        # Add optional parameters
        if width is not None:
            workflow_params["width"] = width
        if height is not None:
            workflow_params["height"] = height
        if duration is not None:
            workflow_params["duration"] = duration
            if media_type == "video":
                logger.info(f"ðŸ“ Target video duration: {duration:.2f}s (from TTS audio)")
        if negative_prompt is not None:
            workflow_params["negative_prompt"] = negative_prompt
        if steps is not None:
            workflow_params["steps"] = steps
        if seed is not None:
            workflow_params["seed"] = seed
        if cfg is not None:
            workflow_params["cfg"] = cfg
        if sampler is not None:
            workflow_params["sampler"] = sampler
        
        # Add any additional parameters
        workflow_params.update(params)

        # 3. Two-step path for video workflows that need a source image:
        # the pipeline only hands us a text prompt, but the workflow has
        # a ``$image.image!`` tag (LoadImage node). Auto-generate the
        # scene image with the configured image backend (Imagen → Gemini
        # fallback) and hand the LOCAL PATH to ComfyKit — its
        # _handle_media_upload picks it up because LoadImage is in
        # MEDIA_UPLOAD_NODE_TYPES, uploads to input/ folder, and rewrites
        # the inputs.image widget to the server-side filename.
        # (An earlier version of this did the upload manually and passed
        # a bare filename string; ComfyKit silently no-ops on that case
        # because it doesn't match the URL or local-file path branches,
        # leaving the original hardcoded "image (658).png" in place.)
        if (
            media_type == "video"
            and workflow_info.get("source") != "runninghub"  # cloud workflows handle their own image gen
            and "image" not in workflow_params
        ):
            needs = _workflow_input_tags(workflow_info["path"])
            if "image" in needs:
                logger.info(
                    "🖼  Video workflow needs source image — generating via "
                    "image backend before handing off to ComfyUI."
                )
                image_result = await self._generate_scene_image(prompt)
                # Hand ComfyKit the on-disk path; it'll upload and rewrite.
                workflow_params["image"] = image_result.url
                logger.info(
                    f"🖼  Scene image ready at {image_result.url} — "
                    f"ComfyKit will upload to ComfyUI input/."
                )

        logger.debug(f"Workflow parameters: {workflow_params}")

        # 4. Execute workflow using shared ComfyKit instance from core
        try:
            # Get shared ComfyKit instance (lazy initialization + config hot-reload)
            kit = await self.core._get_or_create_comfykit()
            
            # Determine what to pass to ComfyKit based on source
            if workflow_info["source"] == "runninghub" and "workflow_id" in workflow_info:
                # RunningHub: pass workflow_id (ComfyKit will use runninghub backend)
                workflow_input = workflow_info["workflow_id"]
                logger.info(f"Executing RunningHub workflow: {workflow_input}")
            else:
                # Selfhost: pass file path (ComfyKit will use local ComfyUI)
                workflow_input = workflow_info["path"]
                logger.info(f"Executing selfhost workflow: {workflow_input}")
            
            result = await kit.execute(workflow_input, workflow_params)
            
            # 5. Handle result based on specified media_type
            if result.status != "completed":
                error_msg = result.msg or "Unknown error"
                logger.error(f"Media generation failed: {error_msg}")
                raise Exception(f"Media generation failed: {error_msg}")
            
            # Extract media based on specified type
            if media_type == "video":
                # Video workflow - get video from result
                if not result.videos:
                    logger.error("No video generated (workflow returned no videos)")
                    raise Exception("No video generated")
                
                video_url = result.videos[0]
                logger.info(f"âœ… Generated video: {video_url}")
                
                # Try to extract duration from result (if available)
                duration = None
                if hasattr(result, 'duration') and result.duration:
                    duration = result.duration
                
                return MediaResult(
                    media_type="video",
                    url=video_url,
                    duration=duration
                )
            else:  # image
                # Image workflow - get image from result
                if not result.images:
                    logger.error("No image generated (workflow returned no images)")
                    raise Exception("No image generated")
                
                image_url = result.images[0]
                logger.info(f"âœ… Generated image: {image_url}")
                
                return MediaResult(
                    media_type="image",
                    url=image_url
                )
        
        except Exception as e:
            logger.error(f"Media generation error: {e}")
            raise

    async def _generate_scene_image(self, prompt: str) -> MediaResult:
        """Generate a single scene image using the configured image backend.

        Mirrors the image-mode dispatch in ``__call__`` (imagen → Gemini
        fallback on quota) but always returns an image and never routes
        to ComfyUI. Used by the video-workflow two-step path to feed
        a $image.image! input before kicking off motion generation.
        """
        imagen_cfg = self.config.get("imagen", {}) or {}
        gemini_cfg = self.config.get("gemini", {}) or {}
        license_key = imagen_cfg.get("license_key") or os.environ.get(
            "BARU_LICENSE_KEY", ""
        )
        gemini_key = gemini_cfg.get("api_key") or os.environ.get(
            "GEMINI_API_KEY", ""
        )

        # Try Imagen first when license configured. Quota exhaustion →
        # fall back to Gemini direct (same pattern as image-mode path).
        if license_key:
            try:
                return await generate_image_imagen(
                    prompt=prompt,
                    license_key=license_key,
                    base_url=imagen_cfg.get("base_url") or "https://yohomin.com",
                    aspect_ratio=imagen_cfg.get("aspect_ratio") or "9:16",
                )
            except ImagenQuotaExceeded as exc:
                if not gemini_key:
                    raise
                logger.warning(
                    f"Imagen quota exhausted in scene image gen: {exc}. "
                    f"Falling back to Gemini direct."
                )

        if not gemini_key:
            raise RuntimeError(
                "Neither Imagen license_key nor Gemini api_key configured — "
                "video workflow can't auto-generate scene image. Set one in "
                "Settings → Image gen."
            )
        return await generate_image_gemini(
            prompt=prompt,
            api_key=gemini_key,
            model=gemini_cfg.get("model") or GEMINI_DEFAULT_MODEL,
        )
