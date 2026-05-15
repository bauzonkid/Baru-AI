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
API Routers
"""

from baru_api.routers.health import router as health_router
from baru_api.routers.llm import router as llm_router
from baru_api.routers.tts import router as tts_router
from baru_api.routers.image import router as image_router
from baru_api.routers.content import router as content_router
from baru_api.routers.video import router as video_router
from baru_api.routers.tasks import router as tasks_router
from baru_api.routers.files import router as files_router
from baru_api.routers.resources import router as resources_router
from baru_api.routers.frame import router as frame_router
from baru_api.routers.config import router as config_router
from baru_api.routers.license import router as license_router
from baru_api.routers.history import router as history_router

__all__ = [
    "health_router",
    "llm_router",
    "tts_router",
    "image_router",
    "content_router",
    "video_router",
    "tasks_router",
    "files_router",
    "resources_router",
    "frame_router",
    "config_router",
    "license_router",
    "history_router",
]

