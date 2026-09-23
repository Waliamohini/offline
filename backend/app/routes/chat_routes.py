from fastapi import APIRouter
import logging

from app.services.llm_client import chat_complete

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/chat")
async def chat(data: dict):
    messages = data.get("messages")

    if not messages:
        return {"response": "No messages provided"}

    try:
        reply = chat_complete(messages)
        return {"response": reply}
    except Exception as e:
        logger.error(f"Chat error: {e}")
        return {"response": f"Error: {str(e)}"}
