import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "backend", ".env"))

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("Environment variables missing")
    exit(1)

supabase = create_client(url, key)

with open(os.path.join(os.path.dirname(__file__), "backend", "sql", "add_privacy_settings.sql"), "r") as f:
    sql = f.read()

# Unfortunately the Supabase python client doesn't have an execute raw SQL method for DDL natively, 
# But let's check if the rpc method works if we use a helper, or just ask the user to run it.
print("Please run the backend/sql/add_privacy_settings.sql script manually on your Supabase dashboard.")
