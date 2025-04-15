import requests
import sseclient
import json
import uuid
import re
import time

# Define the server URL
base_url = "http://34.226.219.58:8000"
sse_url = f"{base_url}/sse"

# Connect to SSE endpoint
print(f"Connecting to SSE endpoint: {sse_url}")
headers = {'Accept': 'text/event-stream'}
response = requests.get(sse_url, headers=headers, stream=True)
client = sseclient.SSEClient(response)

# Process messages to get endpoint and session ID
session_id = None
messages_endpoint = None

print("Waiting for endpoint message...")
for event in client.events():
    print(f"Event: {event.event}, Data: {event.data}")
    
    if event.event == 'endpoint':
        messages_endpoint = event.data
        session_id_match = re.search(r'session_id=([a-zA-Z0-9]+)', messages_endpoint)
        if session_id_match:
            session_id = session_id_match.group(1)
            print(f"Found session ID: {session_id}")
            break

if not session_id:
    print("Failed to get session ID")
    exit(1)

# Send a request to the messages endpoint
messages_url = f"{base_url}{messages_endpoint}"
print(f"Using messages URL: {messages_url}")

# Generate a unique request ID so we can identify the response
request_id = str(uuid.uuid4())
payload = {
    "jsonrpc": "2.0",
    "id": request_id,
    "method": "list_tools"
}

print(f"Sending request with ID: {request_id}")
headers = {'Content-Type': 'application/json'}
response = requests.post(messages_url, headers=headers, json=payload)

print(f"Response status: {response.status_code}")
print(f"Response body: {response.text}")

# Since the server uses SSE for responses, wait for the response message
print("Waiting for response via SSE...")

# Create a new SSE client (the previous one might have reached end of stream)
sse_response = requests.get(sse_url, headers={'Accept': 'text/event-stream'}, stream=True)
sse_client = sseclient.SSEClient(sse_response)

# Start looking for messages
tool_response_received = False
timeout = time.time() + 15  # 15 second timeout

while not tool_response_received and time.time() < timeout:
    try:
        for event in sse_client.events():
            print(f"Received event: {event.event}")
            
            # Regular data events could contain our response
            if event.event == 'message' or not event.event:
                print(f"Data: {event.data}")
                
                try:
                    data = json.loads(event.data)
                    if isinstance(data, dict) and data.get('id') == request_id:
                        print("Found matching response!")
                        print(f"Tools: {json.dumps(data, indent=2)}")
                        tool_response_received = True
                        break
                except json.JSONDecodeError:
                    # Not JSON or not our response
                    pass
                    
            # Check for ping messages
            if 'ping' in event.data:
                print("Received ping")
                
    except Exception as e:
        print(f"Error while processing SSE events: {e}")
        time.sleep(0.5)  # Brief pause before retry

if not tool_response_received:
    print("Timed out waiting for tool response.")

print("Script completed.") 