# server/fix_cors.py
from src.config.index import s3_client, BUCKET_NAME

print(f"Applying CORS rules to Tigris bucket: {BUCKET_NAME}...")

# This rule tells Tigris: "Allow ANY website to upload files here"
cors_configuration = {
    'CORSRules': [{
        'AllowedHeaders': ['*'],
        'AllowedMethods': ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'],
        'AllowedOrigins': ['*'], 
        'ExposeHeaders': ['ETag'],
        'MaxAgeSeconds': 3600  # <--- This is the line Tigris was asking for!
    }]
}

try:
    s3_client.put_bucket_cors(
        Bucket=BUCKET_NAME,
        CORSConfiguration=cors_configuration
    )
    print("✅ Success! Bucket is now unlocked for browser uploads.")
except Exception as e:
    print(f"❌ Error: {e}")