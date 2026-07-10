from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import uuid

class Note(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    content: str
    url: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class NoteCreate(BaseModel):
    content: str
    url: Optional[str] = None