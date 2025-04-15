import requests
import json
import uuid
import time

# Define the server URL
base_url = "http://34.226.219.58:8000"
sse_url = f"{base_url}/sse"

# First connect to the SSE endpoint to get the session ID
headers = {
    "Accept": "text/event-stream",
    "Cache-Control": "no-cache"
}

print(f"Connecting to SSE endpoint: {sse_url}")
response = requests.get(sse_url, headers=headers, stream=True)

if response.status_code != 200:
    print(f"Failed to connect to SSE endpoint: {response.status_code}")
    print(f"Response content: {response.text}")
    exit(1)

# Parse the SSE response to get the session ID
session_id = None
print("Connected to SSE stream, waiting for endpoint message...")

for line in response.iter_lines():
    if line:
        decoded_line = line.decode('utf-8')
        print(f"SSE message: {decoded_line}")
        
        if decoded_line.startswith("event: endpoint"):
            # Next line should contain the data
            data_line = next(response.iter_lines()).decode('utf-8')
            if data_line.startswith("data: "):
                endpoint = data_line[6:]  # Remove "data: " prefix
                print(f"Got messages endpoint: {endpoint}")
                
                # Extract session ID from the endpoint
                if "session_id=" in endpoint:
                    session_id = endpoint.split("session_id=")[1]
                    print(f"Extracted session ID: {session_id}")
                    break

# Close the SSE connection
response.close()

if not session_id:
    print("Failed to get session ID from SSE response")
    exit(1)

# Now send the tools/list request using the session ID
messages_url = f"{base_url}/messages/?session_id={session_id}"
headers = {
    "Content-Type": "application/json"
}

# Create the JSON payload
payload = {
    "jsonrpc": "2.0",
    "id": str(uuid.uuid4()),
    "method": "list_tools"
}

print(f"Sending request to: {messages_url}")
print(f"Payload: {json.dumps(payload)}")

# Send the POST request
response = requests.post(messages_url, headers=headers, json=payload)

# Check if the request was successful
if response.status_code == 200:
    # Parse and print the JSON response
    result = response.json()
    print("\nResponse:")
    print(json.dumps(result, indent=2))
else:
    print(f"Request failed with status code {response.status_code}")
    print(f"Response content: {response.text}") 