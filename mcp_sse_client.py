import asyncio
import json
import time
import requests
import sseclient
import sys

def sse_client(server_url, retry_count=3):
    """Connect to the MCP server using SSE and handle messages"""
    base_url = server_url.rstrip("/")
    sse_url = f"{base_url}/sse"
    request_id = f"req_{int(time.time())}"
    
    print(f"Connecting to MCP server SSE endpoint at {sse_url}")
    
    # Try to connect with retries
    for attempt in range(retry_count):
        try:
            headers = {
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            }
            
            # First try a basic GET request to check server availability
            print(f"Checking server availability...")
            response = requests.get(base_url, timeout=5)
            print(f"Server response: {response.status_code} {response.reason}")
            if response.status_code == 404:
                print("Server is running but returned 404 - this is expected as we're testing the base URL")
            
            # Now connect to the SSE endpoint
            print(f"Connecting to SSE endpoint...")
            response = requests.get(sse_url, headers=headers, stream=True, timeout=10)
            
            if response.status_code != 200:
                print(f"Error: SSE endpoint returned {response.status_code}")
                if attempt < retry_count - 1:
                    print(f"Retrying in 2 seconds... (Attempt {attempt+1}/{retry_count})")
                    time.sleep(2)
                    continue
                else:
                    return
            
            # Initialize SSE client
            client = sseclient.SSEClient(response)
            
            # Send a tools/list request
            tools_request = {
                "type": "tools/list",
                "id": request_id
            }
            
            # Send the request using a separate HTTP request
            print(f"Sending tools/list request with id {request_id}")
            requests.post(
                f"{base_url}/request",
                json=tools_request,
                headers={"Content-Type": "application/json"}
            )
            
            # Process SSE events
            print("Waiting for SSE events...")
            try:
                for event in client:
                    if event.event == "error":
                        print(f"Error event received: {event.data}")
                        break
                    
                    try:
                        data = json.loads(event.data)
                        if 'id' in data and data['id'] == request_id:
                            print(f"Received response to our request: {json.dumps(data, indent=2)}")
                            if 'type' in data and data['type'] == 'tools/list_result':
                                if 'tools' in data:
                                    print("\nAvailable tools:")
                                    for tool in data['tools']:
                                        print(f"- {tool['name']}: {tool['description']}")
                                else:
                                    print("No tools found in response")
                                break
                    except json.JSONDecodeError:
                        print(f"Failed to parse event data: {event.data}")
                    
                    print(f"SSE Event: {event.event}, Data: {event.data[:100]}...")
            except KeyboardInterrupt:
                print("Connection closed by user.")
                return
            
            # If we get here, we successfully connected and received events
            break
                
        except requests.exceptions.RequestException as e:
            print(f"Connection error: {e}")
            if attempt < retry_count - 1:
                print(f"Retrying in 2 seconds... (Attempt {attempt+1}/{retry_count})")
                time.sleep(2)
            else:
                print("Failed to connect to MCP server after multiple attempts")

def try_alternate_endpoints(server_ip, port=8000):
    """Try various endpoint patterns that might be valid for the MCP server"""
    base_url = f"http://{server_ip}:{port}"
    
    # List of potential endpoints to try
    endpoints = [
        "/", 
        "/v1/tools", 
        "/tools", 
        "/list_tools", 
        "/api/tools",
        "/sse",
        "/request",
        "/v1/request",
        "/api/request"
    ]
    
    print(f"Testing various endpoints on {base_url}...")
    
    for endpoint in endpoints:
        url = f"{base_url}{endpoint}"
        try:
            response = requests.get(url, timeout=5)
            status = response.status_code
            print(f"{url}: {status} {response.reason}")
            
            # Only print content for successful responses
            if status == 200:
                content = response.text[:150] + "..." if len(response.text) > 150 else response.text
                print(f"  Content: {content}")
                print(f"  Headers: {dict(response.headers)}")
        except requests.exceptions.RequestException as e:
            print(f"{url}: Error - {e}")

if __name__ == "__main__":
    # Get server IP from command line or use default
    server_ip = sys.argv[1] if len(sys.argv) > 1 else "98.80.135.20"
    port = sys.argv[2] if len(sys.argv) > 2 else "8000"
    server_url = f"http://{server_ip}:{port}"
    
    # First try various endpoints to identify the API structure
    try_alternate_endpoints(server_ip, port)
    
    # Then try to connect using SSE
    print("\n" + "="*50)
    sse_client(server_url) 