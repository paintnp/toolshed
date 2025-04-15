import requests
import json
import uuid
import re
import time

# Define the server URL
base_url = "http://34.226.219.58:8000"
sse_url = f"{base_url}/sse"

print(f"Connecting to SSE endpoint: {sse_url}")
session = requests.Session()
response = session.get(sse_url, headers={"Accept": "text/event-stream"}, stream=True)

if response.status_code != 200:
    print(f"Failed to connect to SSE endpoint: {response.status_code}")
    exit(1)

print("Connection established, waiting for event: endpoint...")

# Process SSE stream and extract session ID
session_id = None
message_endpoint = None
request_id = str(uuid.uuid4())

for line in response.iter_lines():
    if not line:
        continue
        
    line_str = line.decode('utf-8')
    print(f"SSE: {line_str}")
    
    if line_str.startswith("event: endpoint"):
        # Next line should contain the data
        data_line = next(response.iter_lines()).decode('utf-8')
        print(f"SSE data: {data_line}")
        
        if data_line.startswith("data: "):
            message_endpoint = data_line[6:]  # Remove "data: " prefix
            match = re.search(r'session_id=([a-zA-Z0-9]+)', message_endpoint)
            if match:
                session_id = match.group(1)
                print(f"Found session ID: {session_id}")
                break

if not session_id:
    print("Failed to get session ID")
    exit(1)

# Keep the SSE connection open in the background
print(f"Using message endpoint: {message_endpoint}")

# Make a request to get tools
messages_url = f"{base_url}{message_endpoint}"
payload = {
    "jsonrpc": "2.0",
    "id": request_id,
    "method": "list_tools"
}

print(f"Sending request to {messages_url} with ID {request_id}")
post_response = session.post(
    messages_url,
    headers={"Content-Type": "application/json"},
    json=payload
)

print(f"Request status: {post_response.status_code}")
print(f"Request response: {post_response.text}")

# Now wait for the actual results via SSE
print("Waiting for tool list response via SSE...")
tool_response_received = False
timeout = time.time() + 20  # 20 second timeout

while not tool_response_received and time.time() < timeout:
    for line in response.iter_lines():
        if not line:
            continue
            
        line_str = line.decode('utf-8')
        print(f"SSE: {line_str}")
        
        if "data: " in line_str:
            try:
                # Extract JSON data from the line
                data_json = line_str.split("data: ", 1)[1]
                data = json.loads(data_json)
                
                # Check if this is a response to our request
                if data.get("id") == request_id:
                    print(f"Found response for request ID {request_id}")
                    print(f"Tool list: {json.dumps(data, indent=2)}")
                    tool_response_received = True
                    break
            except (json.JSONDecodeError, IndexError):
                # Not a JSON response or not properly formatted
                pass
    
    if not tool_response_received:
        print("No response yet, continuing to listen...")
        time.sleep(1)

if not tool_response_received:
    print("Timed out waiting for response")

print("Script completed") 