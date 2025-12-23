from pydantic import BaseModel, Field
from typing import Optional


class ProjectCreate(BaseModel):
    name: str = Field(..., description="The name of the project")
    description: Optional[str] = Field(None, description="Project description")


class ChatCreate(BaseModel):
    title: str = Field(..., description="The title of the chat")
    project_id: str = Field(..., description="The ID of the project")
