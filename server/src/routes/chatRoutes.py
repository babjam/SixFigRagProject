from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List

# ✅ FIX 1: Correct Imports for your project structure
from src.services.supabase import supabase
from src.services.clerkAuth import get_current_user_clerk_id

# ✅ FIX 2: LangChain Imports for the "Brain"
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

# Initialize LLM (Ensure OPENAI_API_KEY is in your .env)
llm = ChatOpenAI(model="gpt-4o", temperature=0)

router = APIRouter(tags=["chatRoutes"])

# --- MODELS ---
class ChatCreate(BaseModel):
    title: str
    project_id: str

class SendMessageRequest(BaseModel):
    content: str

# --- ROUTES ---

# 1. Create Chat
@router.post("/api/chats")
async def create_chat(
    chat: ChatCreate, 
    clerk_id: str = Depends(get_current_user_clerk_id)
):
    try:
        # Insert into DB
        result = supabase.table("chats").insert({
            "title": chat.title, 
            "project_id": chat.project_id, 
            "clerk_id": clerk_id
        }).execute()

        if not result.data:
            raise HTTPException(status_code=422, detail="Failed to create chat")

        return {
            "message": "Chat created successfully", 
            "data": result.data[0]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create chat: {str(e)}")


# 2. Delete Chat
@router.delete("/api/chats/{chat_id}")
async def delete_chat(
    chat_id: str, 
    clerk_id: str = Depends(get_current_user_clerk_id)
):
    try:
        # Verify ownership and delete
        deleted_result = supabase.table("chats")\
            .delete()\
            .eq("id", chat_id)\
            .eq("clerk_id", clerk_id)\
            .execute()

        if not deleted_result.data: 
            raise HTTPException(status_code=404, detail="Chat not found or access denied")

        return {
            "message": "Chat Deleted Successfully", 
            "data": deleted_result.data[0]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete chat: {str(e)}")


# 3. Get Chat History
@router.get("/api/chats/{chat_id}")
async def get_chat(
    chat_id: str,
    clerk_id: str = Depends(get_current_user_clerk_id)
):
    try:
        # A. Get the chat metadata (Title, ID)
        chat_result = supabase.table('chats').select('*')\
            .eq('id', chat_id)\
            .eq('clerk_id', clerk_id)\
            .execute()
        
        if not chat_result.data:
            raise HTTPException(status_code=404, detail="Chat not found or access denied")
        
        chat_data = chat_result.data[0]
        
        # B. Get messages (Sorted by oldest first)
        messages_result = supabase.table('messages').select('*')\
            .eq('chat_id', chat_id)\
            .order('created_at', desc=False)\
            .execute()
        
        # C. Combine them
        chat_data['messages'] = messages_result.data or []
        
        return {
            "message": "Chat retrieved successfully",
            "data": chat_data
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get chat: {str(e)}")


# 4. Send Message (The "Brain")
@router.post("/api/projects/{project_id}/chats/{chat_id}/messages")
async def send_message(
    project_id: str,    # 👈 ✅ FIX 3: Added project_id argument so it matches the URL
    chat_id: str,
    request: SendMessageRequest,
    clerk_id: str = Depends(get_current_user_clerk_id)
):
    """
        User message → Save → LLM → Save → Return both
    """
    try:
        message_content = request.content
        print(f"💬 Project {project_id}: New message: {message_content[:50]}...")
        
        # A. Save User Message
        user_msg_result = supabase.table('messages').insert({
            "chat_id": chat_id,
            "content": message_content,
            "role": "user",
            "clerk_id": clerk_id
        }).execute()
        
        user_message = user_msg_result.data[0]
        
        # B. Call LLM (LangChain)
        messages = [
            SystemMessage(content="You are a helpful AI engineering assistant."),
            HumanMessage(content=message_content)
        ]
        
        response = llm.invoke(messages)
        ai_response_text = response.content
        
        # C. Save AI Message
        ai_msg_result = supabase.table('messages').insert({
            "chat_id": chat_id,
            "content": ai_response_text,
            "role": "assistant",
            "clerk_id": clerk_id
        }).execute()
        
        ai_message = ai_msg_result.data[0]
        
        # D. Return Data (Matches Frontend expectations)
        return {
            "message": "Messages sent successfully",
            "data": {
                "userMessage": user_message,
                "aiMessage": ai_message
            }
        }
        
    except Exception as e:
        print(f"❌ Error in send_message: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))