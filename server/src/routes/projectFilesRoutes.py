from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import uuid
from tasks import process_document
# --- Custom Imports (Your Tools) ---
from src.services.supabase import supabase
from src.services.clerkAuth import get_current_user_clerk_id
from src.config.index import s3_client, BUCKET_NAME

# Initialize the "Menu Section" for Files
router = APIRouter(tags=["projectFilesRoutes"])

# --- VALIDATION MODELS (The Order Forms) ---
# These ensure the Frontend sends exactly what we need. 
# If data is missing, the "Waiter" (FastAPI) rejects the order before it hits the kitchen.

class FileUploadRequest(BaseModel):
    filename: str
    file_type: str
    file_size: int

class UrlAddRequest(BaseModel):
    url: str

# --- ENDPOINTS (The Menu Items) ---

"""
1. GET PROJECT FILES
   The "Pantry Check". The frontend asks: "What ingredients do we have?"
   We check the database (Logbook) and return the list.
"""
@router.get("/{project_id}/files")
async def get_project_files(
    project_id: str, 
    current_user_clerk_id: str = Depends(get_current_user_clerk_id)
):
    try:
        project_files_result = (
            supabase.table("project_documents")
            .select("*")
            .eq("project_id", project_id)
            .eq("clerk_id", current_user_clerk_id)
            .order("created_at", desc=True)
            .execute()
        )

        return {
            "message": "Project files retrieved successfully",
            "data": project_files_result.data or [],
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving files: {str(e)}",
        )

"""
2. GET UPLOAD URL
   The "Security Pass". The user wants to bring their own file.
   We don't accept the file here directly (it's too heavy).
   Instead, we give them a specific, temporary Ticket (Presigned URL) 
   to drop it off at the loading dock (S3/Tigris) themselves.
"""
@router.post("/{project_id}/files/upload-url")
async def get_upload_url(
    project_id: str,
    file_request: FileUploadRequest,
    clerk_id: str = Depends(get_current_user_clerk_id)
):
    try:
        # Step A: Verify they own the "Restaurant" (Project)
        project_result = supabase.table("projects").select("id").eq("id", project_id).eq("clerk_id", clerk_id).execute()
        if not project_result.data:
            raise HTTPException(status_code=404, detail="Project not found")

        # Step B: Create a unique ID tag for this specific file
        # We handle the naming here so files don't overwrite each other in the bucket
        file_extension = file_request.filename.split(".")[-1] if "." in file_request.filename else ""
        unique_id = str(uuid.uuid4())
        s3_key = f"projects/{project_id}/documents/{unique_id}.{file_extension}"

        # Step C: Generate the "Magic Link" (Presigned URL)
        # This link lets the frontend talk directly to the Storage Bucket for 1 hour
        presigned_url = s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": s3_key,
                "ContentType": file_request.file_type,
            },
            ExpiresIn=3600,
        )

        # Step D: Log the "Incoming Delivery" in the Database
        # Status is 'uploading' because the file isn't physically there yet
        document_result = supabase.table("project_documents").insert({
            "project_id": project_id,
            "s3_key": s3_key,
            "file_name": file_request.filename,
            "file_type": file_request.file_type,
            "file_size": file_request.file_size,
            "clerk_id": clerk_id,
            "processing_status": "uploading", # <--- Waiting for arrival
        }).execute()

        if not document_result.data:
            raise HTTPException(status_code=500, detail="Failed to create document record")

        return {
            "message": "Pre-signed URL generated successfully",
            "data": {
                "upload_url": presigned_url,
                "s3_key": s3_key,
                "document_id": document_result.data[0]
            }
        }
    except HTTPException as e:
        raise e # Re-raise known errors (like 404)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate pre-signed URL: {str(e)}")

"""
3. CONFIRM UPLOAD
   The "Delivery Receipt". The frontend says: "I successfully dropped off the file at S3."
   We update our logbook from "Expecting" (uploading) to "Ready" (queued).
"""
@router.post("/{project_id}/files/confirm-upload")
async def confirm_upload(
    project_id: str,
    confirm_request: dict,
    clerk_id: str = Depends(get_current_user_clerk_id)
):
    try:
        s3_key = confirm_request.get("s3_key")
        if not s3_key:
            raise HTTPException(status_code=400, detail="s3_key is required")

        # Update status to "queued"
        # This acts as the Green Flag for the RAG Worker to start eating
        project_result = supabase.table("project_documents").update({
            "processing_status": "queued" 
            }).eq("s3_key", s3_key).eq("clerk_id", clerk_id).eq("project_id", project_id).execute()
        document = project_result.data[0]
        document_id = document["id"]

        if not project_result.data:
            raise HTTPException(status_code=404, detail="Document not found")
        
        # [RAG INJECTION POINT] 
        # In the future, we might trigger a background task here immediately.
        # e.g., task_queue.add(process_file, file_id)

        task=process_document.delay(document_id=document_id)
        #store task_id somewhere if needed for tracking
        supabase.table("project_documents").update({
            "task_id": task.id 
        }).eq("id", document_id).execute()
        return {
            "message": "Upload confirmed and processing started",
            "data": project_result.data[0]
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error confirming upload: {str(e)}",
        )

"""
4. ADD URL
   The "Remote Order". Instead of a file, the user gives a link.
   We save it as "queued" so the Worker knows to go scrape it later.
"""
@router.post("/{project_id}/urls")
async def add_url(
    project_id: str,
    url_request: UrlAddRequest,
    clerk_id: str = Depends(get_current_user_clerk_id)
):
    try:
        # Validate and clean the URL
        url = url_request.url.strip()
        if not url.startswith(("http://", "https://")):
            url = "https://" + url

        # Insert into Database
        # Note: s3_key is empty because there is no file in the bucket yet
        url_result = supabase.table("project_documents").insert({
            "project_id": project_id,
            "clerk_id": clerk_id,
            "file_name": url,       # We use the URL as the name
            "file_size": 0,
            "file_type": "text/html",
            "processing_status": "queued",
            "s3_key": "",
            "source_type": "url",   # Helper flag for the Worker
            "source_url": url
        }).execute()

        if not url_result.data:
            raise HTTPException(status_code=500, detail="Failed to add URL")
        document = url_result.data[0]
        document_id = document["id"]
        # [RAG INJECTION POINT]
        # Same here: This 'queued' status is the signal for the scraper to start.
        task=process_document.delay(document_id=document_id)
        #store task_id somewhere if needed for tracking
        supabase.table("project_documents").update({
            "task_id": task.id 
        }).eq("id", document_id).execute()
        return {
            "message": "URL added successfully",
            "data": url_result.data[0]  
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add URL: {str(e)}")

"""
5. DELETE FILE
   The "Cleanup". Removes the file from the Freezer (S3) AND the Menu (Database).
"""
@router.delete("/{project_id}/files/{file_id}")
async def delete_project_file(
    project_id: str,
    file_id: str,
    clerk_id: str = Depends(get_current_user_clerk_id)
):
    try:
        # Step A: Find the file record first to get the s3_key
        file_result = supabase.table("project_documents").select("*").eq("id", file_id).eq("project_id", project_id).eq("clerk_id", clerk_id).execute()
        if not file_result.data:
            raise HTTPException(status_code=404, detail="File not found")

        file_record = file_result.data[0]

        # Step B: Delete the physical file from Storage (if it exists)
        s3_key = file_record.get("s3_key")
        if s3_key:
            try:
                s3_client.delete_object(Bucket=BUCKET_NAME, Key=s3_key)
                print(f"Deleted file from S3: {s3_key}")
            except Exception as s3_error:
                print(f"Error deleting file from S3: {s3_error}")

        # Step C: Delete the record from the Database
        deleted_result = (
            supabase.table("project_documents")
            .delete()
            .eq("id", file_id)
            .eq("clerk_id", clerk_id)
            .execute()
        )

        return {
            "message": "File deleted successfully",
            "data": deleted_result.data[0],
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error deleting file: {str(e)}",
        )
    

@router.get("/{project_id}/files/{file_id}/chunks")
async def get_document_chunks(
    project_id: str,
    file_id: str,
    clerk_id: str = Depends(get_current_user_clerk_id)
):
    try:
        # 1. Security Check: Does this project belong to the user?
        project_result = supabase.table('projects').select('id').eq('id', project_id).eq('clerk_id', clerk_id).execute()
        
        if not project_result.data:
            raise HTTPException(status_code=404, detail="Project not found or access denied")
        
        # 2. Integrity Check: Does this file belong to this project?
        # Note: 'file_id' here maps to 'document_id' in your table logic, but the UI passes it as the file ID.
        doc_result = supabase.table('project_documents').select('id').eq('id', file_id).eq('project_id', project_id).execute()
        
        if not doc_result.data:
            raise HTTPException(status_code=404, detail="Document not found")
        
        # 3. Fetch Chunks
        chunks_result = supabase.table('document_chunks').select('*').eq('document_id', file_id).order('chunk_index').execute()
        
        return {
            "message": "Document chunks retrieved successfully",
            "data": chunks_result.data or []
        }

    except Exception as e:
        print(f"ERROR getting chunks: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get document chunks: {str(e)}")