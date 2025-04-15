import requests
import json
import uuid
import re
import time

# Define the server URL
BASE_URL = "http://34.226.219.58:8000"

def get_session_id(timeout=10):
    """Connect to SSE and extract the session ID from the endpoint message"""
    print(f"Connecting to SSE endpoint at {BASE_URL}/sse")
    
    # Use a timeout to avoid hanging
    start_time = time.time()
    session_id = None
    
    with requests.get(f"{BASE_URL}/sse", 
                    headers={"Accept": "text/event-stream"}, 
                    stream=True, 
                    timeout=5) as response:
        
        if response.status_code != 200:
            print(f"Failed to connect: {response.status_code}")
            return None
            
        print("Connected, looking for endpoint event...")
        
        for line in response.iter_lines():
            # Check timeout
            if time.time() - start_time > timeout:
                print(f"Timeout after {timeout} seconds")
                break
                
            if not line:
                continue
                
            line_text = line.decode('utf-8')
            print(f"< {line_text}")
            
            # Look for the endpoint event
            if line_text == "event: endpoint":
                try:
                    # The next line should contain data: /messages/?session_id=xxx
                    data_line = next(response.iter_lines()).decode('utf-8')
                    print(f"< {data_line}")
                    
                    if data_line.startswith("data: "):
                        endpoint = data_line[6:]  # Skip "data: " prefix
                        match = re.search(r'session_id=([a-zA-Z0-9]+)', endpoint)
                        if match:
                            session_id = match.group(1)
                            print(f"Found session ID: {session_id}")
                            break
                except Exception as e:
                    print(f"Error reading data line: {e}")
    
    return session_id

def send_command(session_id, method, params=None):
    """Send a command to the server and return the response"""
    if params is None:
        params = {}
        
    messages_url = f"{BASE_URL}/messages/?session_id={session_id}"
    request_id = str(uuid.uuid4())
    
    payload = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method
    }
    
    # Only add params if they're non-empty
    if params:
        payload["params"] = params
    
    print(f"Sending request to {messages_url}")
    print(f"Payload: {json.dumps(payload)}")
    
    response = requests.post(
        messages_url,
        headers={"Content-Type": "application/json"},
        json=payload,
        timeout=5
    )
    
    print(f"Response status: {response.status_code}")
    if response.text:
        print(f"Response content: {response.text}")
    
    return response.status_code, response.text, request_id

def main():
    # Get a session ID
    session_id = get_session_id()
    if not session_id:
        print("Failed to get session ID")
        return
        
    # Send a list_tools command
    status, content, request_id = send_command(session_id, "list_tools")
    
    # For 202 responses, the actual result will come later via SSE
    if status == 202:
        print("Command accepted, the result will be sent via SSE")
        print(f"Request ID to look for in SSE stream: {request_id}")
    
    print("Script completed")

if __name__ == "__main__":
    main() 