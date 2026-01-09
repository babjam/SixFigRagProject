import os
import time
from celery import Celery
from src.services.supabase import supabase
from src.config.index import s3_client, BUCKET_NAME

from collections import Counter

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.messages import HumanMessage

# ONLY import PDF partition for now
from unstructured.partition.pdf import partition_pdf
from unstructured.partition.html import partition_html 
from unstructured.partition.docx import partition_docx
from unstructured.partition.pptx import partition_pptx
from unstructured.partition.text import partition_text
from unstructured.partition.md import partition_md

from unstructured.chunking.title import chunk_by_title

# Scarping Website
from scrapingbee import ScrapingBeeClient # 👈 NEW
# 👈 NEW

# Initialize ScrapingBee
scrapingbee_client = ScrapingBeeClient(api_key=os.getenv("SCRAPINGBEE_API_KEY")) # 👈 NEW


# --- PART 1: THE CHEF (Configuration) ---

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

def update_status(document_id: str, status: str, details: dict = None):
    """
    Update status with optional details
    """
    result = supabase.table("project_documents").select("processing_details").eq("id", document_id).execute()

    current_details = {}
    if result.data and result.data[0]["processing_details"]:
        current_details = result.data[0]["processing_details"]

    if details:
        current_details.update(details)

    supabase.table("project_documents").update({
        "processing_status": status,
        "processing_details": current_details
    }).eq("id", document_id).execute()


celery_app = Celery(
    "rag_app",
    broker=REDIS_URL,
    backend=REDIS_URL
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
)

# --- PART 2: THE RECIPE (The Task) ---

@celery_app.task
def process_document(document_id: str):
    """
    Document Processing Task
    """
    print(f"👨‍🍳 Chef received order: {document_id}")
    try:
        # 1. Fetch metadata
        doc_result = supabase.table("project_documents").select("*").eq("id", document_id).execute()
        if not doc_result.data:
            print(f"❌ Error: Document {document_id} not found in DB.")
            return

        document = doc_result.data[0]
        source_type = document.get("source_type", "file")
        
        # Step 1. Download & Partition
        update_status(document_id, "partitioning")
        elements = download_and_partition(document_id, document)
        
        if not elements:
            print("⚠️ No elements extracted.")
            return

        # Step 2. Chunk elements
        chunks, chunking_metrics = chunk_elements_by_title(elements)
        update_status(document_id, "summarising", {
            "chunking": chunking_metrics
        })

        # Step 3. Summarize (Prepare Data Only)
        processed_chunks = summarise_chunks(chunks, document_id, source_type)

        # Step 4. Vectorize & Save (The Teacher's Method)
        update_status(document_id, "vectorization")  # Update UI to next step
        stored_chunk_ids = store_chunks_with_embeddings(document_id, processed_chunks)

        # Mark as completed
        update_status( document_id,"completed")
        print(f"REAL Celery task completed for document:{document_id} with {len(stored_chunk_ids)} chunks")

        return {
            "status": "completed",
            "document_id": document_id,
            "elements_found": len(elements),
            "chunks_stored": len(stored_chunk_ids)
        }

    except Exception as e:
        print(f"❌ Critical Error in task: {e}")
        return {"status": "failed", "error": str(e)}


def download_and_partition(document_id: str, document: dict):
    source_type = document.get("source_type", "file")
    elements = [] 

    if source_type == "url":
        # Crawl URL 
        url = document["source_url"] 
        
        # Fetch content with ScrapingBee
        print(f"🕸️ Scraping URL: {url}")
        # Added render_js=True for better compatibility with modern sites
        response = scrapingbee_client.get(url, params={'render_js': 'True'})
        
        # Save to temp file
        # FIX: Removed /tmp/ to ensure it works on Windows too, consistent with PDF logic
        temp_file = f"temp_{document_id}.html"
        with open(temp_file, 'wb') as f:
            f.write(response.content)
        
        elements = partition_document(temp_file, "html")

        # FIX: Cleanup temp file (was missing for URL path)
        if os.path.exists(temp_file):
            os.remove(temp_file)

    else:
        print("Downloading and partitioning document...")
        s3_key = document["s3_key"] 
        file_name = document["file_name"]
        file_type = file_name.split(".")[-1].lower() 
        temp_file = f"temp_{document_id}.{file_type}"
        
        print(f"📥 Downloading from Bucket: {BUCKET_NAME}, Key: {s3_key}")
        s3_client.download_file(BUCKET_NAME, s3_key, temp_file)
        
        elements = partition_document(temp_file, file_type)
        
        if os.path.exists(temp_file):
            os.remove(temp_file)

    elements_summary = analyze_elements(elements)

    update_status(document_id, "chunking", {
        "partitioning": {
            "elements_found": elements_summary
        }
    })
    
    return elements


def partition_document(temp_file: str, file_type: str):
    print(f"✂️ Partitioning file type: {file_type}...")
    
    # 1. HTML (ScrapingBee)
    if file_type == "html":
        return partition_html(filename=temp_file)
    
    # 2. PDF
    elif file_type == "pdf":
        return partition_pdf(
            filename=temp_file,
            strategy="hi_res",
            infer_table_structure=True,
            extract_image_block_types=["Image"],
            extract_image_block_to_payload=True
        )

    # 3. Word Documents (DOCX) - Same strategies as PDF
    elif file_type in ["doc", "docx"]:
        return partition_docx(
            filename=temp_file,
            strategy="hi_res",
            infer_table_structure=True,
            extract_image_block_types=["Image"],
            extract_image_block_to_payload=True
        )
    
    # 4. PowerPoint (PPTX) - Same strategies as PDF
    elif file_type in ["ppt", "pptx"]:
        return partition_pptx(
            filename=temp_file,
            strategy="hi_res",
            infer_table_structure=True,
            extract_image_block_types=["Image"],
            extract_image_block_to_payload=True
        )
        
    # 5. Markdown (MD)
    elif file_type in ["md", "markdown"]:
        return partition_md(filename=temp_file)
        
    # 6. Plain Text (TXT)
    elif file_type in ["txt", "text", "log"]:
        return partition_text(filename=temp_file)
        
    return []


def analyze_elements(elements):
    print("🔍 Analyzing document structure...")
    normalized_categories = []
    for e in elements:
        cat = getattr(e, "category", "Unknown")
        if cat in ["Table", "Image"]:
            normalized_categories.append(cat)
        else:
            normalized_categories.append("Text")
    
    counts = dict(Counter(normalized_categories))
    print(f"📊 Elements Breakdown ({len(elements)} total): {counts}")
    return counts


def chunk_elements_by_title(elements):
    print("🔨 Creating smart chunks...")
    chunks = chunk_by_title(
        elements, 
        max_characters=3000, 
        new_after_n_chars=2400, 
        combine_text_under_n_chars=500 
    )
    total_chunks = len(chunks)
    chunking_metrics = {"total_chunks": total_chunks}
    print(f"✅ Created {total_chunks} chunks")
    return chunks, chunking_metrics


# --- SUMMARIZATION (PREPARE DATA) ---

def summarise_chunks(chunks, document_id, source_type="file"):
    """
    Step 3: Prepare the chunk data (Summary + Metadata) but DO NOT save yet.
    """
    print(f"🧠 Summarizing {len(chunks)} chunks...")
    try:
        processed_chunks = []
        total_chunks = len(chunks)

        for i, chunk in enumerate(chunks):
            current_chunk = i + 1

            # Update UI Progress
            update_status(document_id, "summarising", {
                "summarising": {
                    "current_chunk": current_chunk,
                    "total_chunks": total_chunks,
                }
            })  

            # Analyze Content Type
            content_data = separate_content_types(chunk, source_type)

            # Conditional AI Summarization
            if content_data["tables"] or content_data["images"]:
                enhanced_content = create_ai_summary(
                    content_data["text"],
                    content_data["tables"],
                    content_data["images"]
                )
            else:
                enhanced_content = content_data["text"]

            # Prepare Metadata
            original_content = {"text": content_data["text"]}
            if content_data["tables"]:
                original_content["tables"] = content_data["tables"]
            if content_data["images"]:
                original_content["images"] = content_data["images"]

            # Build Object (NO INSERT HERE)
            processed_chunk = {
                # "document_id": document_id, <-- Teacher adds this later in the next function
                "content": enhanced_content,
                "original_content": original_content,
                "type": content_data["types"],
                # "chunk_index": i, <-- Teacher adds this later
                "page_number": get_page_number(chunk, i),
                "char_count": len(enhanced_content),
            }

            processed_chunks.append(processed_chunk)

        print(f"✅ Prepared {len(processed_chunks)} chunks for vectorization.")
        return processed_chunks

    except Exception as e:
        print(f"❌ Error in summarization loop: {e}")
        raise e


# --- VECTORIZATION & STORAGE (TEACHER'S METHOD) ---

def store_chunks_with_embeddings(document_id: str, processed_chunks: list):
    """
    Step 4: Generate Embeddings & Save to DB (Matches Course Video)
    """
    print(f"🧬 Generating embeddings for {len(processed_chunks)} chunks...")
    
    # Initialize Embedding Model
    embeddings_model = OpenAIEmbeddings(model="text-embedding-3-small")
    
    # 1. Extract content for embedding generation
    texts = [chunk['content'] for chunk in processed_chunks]
    
    # 2. Generate embeddings in batches to avoid API limits
    batch_size = 10
    all_embeddings = []
    
    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i : i + batch_size]
        batch_embeddings = embeddings_model.embed_documents(batch_texts)
        all_embeddings.extend(batch_embeddings)
        print(f"   Generated embeddings for batch {i//batch_size + 1}/{(len(texts) + batch_size - 1)//batch_size}")

    # 3. Store chunks with embeddings
    print("💾 Storing chunks with embeddings in database...")
    stored_chunk_ids = []

    # Zip the data with the vectors and save
    for i, (chunk_data, embedding) in enumerate(zip(processed_chunks, all_embeddings)):
        
        # Combine everything into one final payload
        chunk_data_with_embedding = {
            **chunk_data,                # The content & metadata
            "document_id": document_id,  # Add Foreign Key
            "chunk_index": i,            # Add Index
            "embedding": embedding       # Add Vector
        }
        
        # Insert row
        result = supabase.table("document_chunks").insert(chunk_data_with_embedding).execute()
        
        # Collect ID (Safely handle if result returns list or object)
        if result.data:
            stored_chunk_ids.append(result.data[0]['id'])

    print(f"✅ Successfully stored {len(stored_chunk_ids)} chunks with embeddings.")
    return stored_chunk_ids


# --- HELPERS ---

def separate_content_types(chunk, source_type="file"):
    content_data = {
        'text': chunk.text,
        'tables': [],
        'images': [],
        'types': ['text']
    }
    
    if hasattr(chunk, 'metadata') and hasattr(chunk.metadata, 'orig_elements'):
        for element in chunk.metadata.orig_elements:
            element_type = type(element).__name__
            
            if element_type == 'Table':
                content_data['types'].append('table')
                table_html = getattr(element.metadata, 'text_as_html', element.text)
                content_data['tables'].append(table_html)
            
            elif element_type == 'Image':
                if hasattr(element, 'metadata') and hasattr(element.metadata, 'image_base64'):
                    content_data['types'].append('image')
                    content_data['images'].append(element.metadata.image_base64)
    
    content_data['types'] = list(set(content_data['types']))
    return content_data


def create_ai_summary(text, tables, images):
    try:
        llm = ChatOpenAI(model="gpt-4o", temperature=0)
        
        prompt_text = f"""You are creating a searchable description for document content retrieval.
        CONTENT TO ANALYZE:
        TEXT CONTENT: {text}
        """
        
        if tables:
            prompt_text += "TABLES:\n"
            for i, table in enumerate(tables):
                prompt_text += f"Table {i+1}:\n{table}\n\n"
        
        prompt_text += """
        YOUR TASK: 
        Generate a comprehensive, searchable description that covers:
        
        1. Key facts, numbers, and data points from text and tables
        2. Main topics and concepts discussed  
        3. Questions this content could answer (CRITICAL for RAG)
        4. Visual content analysis (charts, diagrams, patterns in images)
        5. Alternative search terms users might use

        Make it detailed and searchable - prioritize findability over brevity.

        SEARCHABLE DESCRIPTION:"""

        message_content = [{"type": "text", "text": prompt_text}]
        
        for image_base64 in images:
            message_content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}
            })
        
        message = HumanMessage(content=message_content)
        response = llm.invoke([message])
        return response.content
        
    except Exception as e:
        print(f"❌ AI summary failed: {e}")
        return text 


def get_page_number(chunk, chunk_index):
    if hasattr(chunk, "metadata"):
        page_number = getattr(chunk.metadata, "page_number", None)
        if page_number is not None:
            return page_number
    return 1