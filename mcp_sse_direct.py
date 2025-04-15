#!/usr/bin/env python3
import json
import requests
import sseclient
import sys
import time

def connect_to_mcp_sse(server_url):
    """Connect to the MCP server using SSE and query for available tools"""
    # Ensure the URL is properly formatted
    base_url = server_url.rstrip("/")
    
    print(f"Connecting to MCP server at {base_url}")
    
    # Set up headers for SSE connection
    headers = {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    }
    
    # First check server availability with a longer timeout
    try:
        print(f"Checking server availability...")
        response = requests.get(base_url, timeout=10)
        print(f"Server response: {response.status_code} {response.reason}")
    except requests.exceptions.RequestException as e:
        print(f"Initial connection error: {e}")
        # Try alternate endpoints
        print("Trying alternate endpoints...")
        try_alternate_endpoints(base_url)
        return
    
    # Connect to the SSE endpoint
    try:
        print(f"Connecting to SSE endpoint...")
        response = requests.get(base_url, headers=headers, stream=True, timeout=10)
        
        if response.status_code != 200:
            print(f"Error: SSE endpoint returned {response.status_code}")
            return
        
        # Initialize SSE client
        client = sseclient.SSEClient(response)
        
        # Generate unique request ID
        request_id = f"request_tools_list_{int(time.time())}"
        
        # Send a tools/list request
        tools_request = {
            "type": "tools/list",
            "id": request_id
        }
        
        # Send the request using a separate HTTP request
        request_endpoint = f"{base_url.replace('/sse', '')}/request"
        print(f"Sending tools/list request with id {request_id} to {request_endpoint}")
        
        requests.post(
            request_endpoint,
            json=tools_request,
            headers={"Content-Type": "application/json"}
        )
        
        # Process SSE events
        print("Waiting for SSE events...")
        
        for event in client:
            if event.event == "error":
                print(f"Error event received: {event.data}")
                break
            
            try:
                data = json.loads(event.data)
                print(f"Received event: {event.event}")
                print(json.dumps(data, indent=2))
                
                # Check if this is a response to our tools/list request
                if 'id' in data and data['id'] == request_id:
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
    
    except requests.exceptions.RequestException as e:
        print(f"Connection error: {e}")
    except KeyboardInterrupt:
        print("Connection closed by user.")

def try_alternate_endpoints(base_url):
    """Try various endpoints that might work"""
    # Extract server base without path
    if '/sse' in base_url:
        server_base = base_url.replace('/sse', '')
    else:
        server_base = base_url
        
    endpoints = [
        "/",
        "/sse",
        "/v1",
        "/api",
        "/tools"
    ]
    
    for endpoint in endpoints:
        url = f"{server_base}{endpoint}"
        try:
            print(f"Trying {url}...")
            response = requests.get(url, timeout=8)
            print(f"Response: {response.status_code} {response.reason}")
            # If successful, print a bit of the content
            if response.status_code == 200:
                content = response.text[:100] + "..." if len(response.text) > 100 else response.text
                print(f"Content: {content}")
        except requests.exceptions.RequestException as e:
            print(f"Error connecting to {url}: {e}")
            continue

def create_simple_client():
    """Create a simpler client that just tries to connect without SSE"""
    server_url = "http://34.226.219.58:8000"
    endpoints = ["/", "/sse", "/v1", "/api", "/tools", "/request", "/list"]
    
    for endpoint in endpoints:
        url = f"{server_url}{endpoint}"
        try:
            print(f"Connecting to {url}")
            response = requests.get(url, timeout=5)
            print(f"Status: {response.status_code} {response.reason}")
            if response.status_code == 200:
                print(f"Content: {response.text[:150]}")
                print(f"Headers: {dict(response.headers)}")
        except requests.exceptions.RequestException as e:
            print(f"Error: {e}")
        print("-" * 40)
        

if __name__ == "__main__":
    # Get server URL from command line or use the provided default
    if len(sys.argv) > 1 and sys.argv[1] == "--probe":
        create_simple_client()
    else:
        server_url = sys.argv[1] if len(sys.argv) > 1 else "http://34.226.219.58:8000/sse"
        # Connect to the MCP server and query for tools
        connect_to_mcp_sse(server_url)