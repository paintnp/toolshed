import requests
import json
import uuid
import re

# Define the server URL
base_url = "http://34.226.219.58:8000"
sse_url = f"{base_url}/sse"

print(f"Connecting to SSE endpoint: {sse_url}")
response = requests.get(sse_url, headers={"Accept": "text/event-stream"}, stream=True)

if response.status_code != 200:
    print(f"Failed to connect to SSE endpoint: {response.status_code}")
    exit(1)

# Get the first few lines to extract session ID
session_id = None
for i, line in enumerate(response.iter_lines()):
    if i > 5:  # Only check the first few lines
        break
    
    if line:
        line_str = line.decode('utf-8')
        print(f"Line {i}: {line_str}")
        
        # Look for session_id in the data line
        match = re.search(r'session_id=([a-zA-Z0-9]+)', line_str)
        if match:
            session_id = match.group(1)
            print(f"Found session ID: {session_id}")
            break

# Close the SSE connection
response.close()

if not session_id:
    print("Failed to extract session ID")
    exit(1)

# Now that we have the session ID, make a request to the messages endpoint
messages_url = f"{base_url}/messages/?session_id={session_id}"
print(f"Making request to: {messages_url}")

payload = {
    "jsonrpc": "2.0", 
    "id": str(uuid.uuid4()),
    "method": "list_tools"
}

print(f"Request payload: {json.dumps(payload)}")
response = requests.post(
    messages_url,
    headers={"Content-Type": "application/json"},
    json=payload
)

print(f"Response status: {response.status_code}")
if response.status_code == 200:
    try:
        result = response.json()
        print(f"Response: {json.dumps(result, indent=2)}")
    except json.JSONDecodeError:
        print(f"Response is not JSON: {response.text[:200]}")
else:
    print(f"Error: {response.text[:200]}") 