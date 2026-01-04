import os
from dotenv import load_dotenv
import boto3

load_dotenv()

if not os.getenv("SUPABASE_API_URL") or not os.getenv("SUPABASE_SECRET_KEY"):
    raise ValueError(
        "SUPABASE_API_URL and SUPABASE_SECRET_KEY must be set in .env file"
    )

if not os.getenv("CLERK_SECRET_KEY") or not os.getenv("DOMAIN"):
    raise ValueError("CLERK_SECRET_KEY and DOMAIN must be set in .env file")

appConfig = {
    "supabase_api_url": os.getenv("SUPABASE_API_URL"),
    "supabase_secret_key": os.getenv("SUPABASE_SECRET_KEY"),
    "clerk_secret_key": os.getenv("CLERK_SECRET_KEY"),
    "domain": os.getenv("DOMAIN"),
}

# S#3 Client Configuration
s3_client = boto3.client(
    "s3",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    endpoint_url=os.getenv("AWS_ENDPOINT_URL_S3"),
    region_name=os.getenv("AWS_REGION"),
    )
BUCKET_NAME = os.getenv("BUCKET_NAME")



