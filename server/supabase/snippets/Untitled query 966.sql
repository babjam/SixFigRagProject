-- 1. Do we have any chunks at all?
SELECT count(*) as total_chunks FROM document_chunks;

-- 2. What settings is this project using?
SELECT embedding_model, similarity_threshold 
FROM project_settings 
WHERE project_id = '9a8a9af5-0261-440e-bf1f-9eb74f2f70ab';

-- 3. Check the vector dimension size (Crucial!)
-- We check one row to see if it is 1536 or 3072
SELECT vector_dims(embedding) as actual_dimensions 
FROM document_chunks 
LIMIT 1;