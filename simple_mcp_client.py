import requests
import json
import sys
import time

def connect_and_list_tools():
    """Connect to the MCP server and list available tools"""
    session = requests.Session()
    
    # Connect to SSE endpoint
    sse_url = "http://34.226.219.58:8000/sse"
    print(f"Connecting to SSE endpoint at {sse_url}")
    
    headers = {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    }
    
    # First, establish the SSE connection
    sse_response = session.get(sse_url, headers=headers, stream=True, timeout=30)
    
    if sse_response.status_code != 200:
        print(f"Failed to connect: {sse_response.status_code} {sse_response.reason}")
        return
    
    print(f"Connected with status {sse_response.status_code}")
    
    # Read the first event to get the session ID
    session_id = None
    for line in sse_response.iter_lines():
        if line:
            decoded_line = line.decode('utf-8')
            print(f"Received: {decoded_line}")
            
            if decoded_line.startswith('event: endpoint'):
                # The next line should contain the data
                continue
            elif decoded_line.startswith('data:') and session_id is None:
                endpoint_url = decoded_line[5:].strip()
                if "session_id=" in endpoint_url:
                    session_id = endpoint_url.split("session_id=")[1]
                    print(f"Connected with session ID: {session_id}")
                    break
    
    if not session_id:
        print("Failed to extract session ID")
        return
    
    # Now send a message to the endpoint to list tools
    message_endpoint = f"http://34.226.219.58:8000/messages/?session_id={session_id}"
    
    # Try different formats for the request
    request_formats = [
        {"type": "tools/list", "id": "request-1"},
        {"client_request": {"type": "tools/list", "id": "request-1"}},
        {"request": {"type": "tools/list", "id": "request-1"}},
        {"message": {"type": "tools/list", "id": "request-1"}}
    ]
    
    for i, request_data in enumerate(request_formats):
        print(f"\nTrying request format {i+1}: {json.dumps(request_data)}")
        
        try:
            message_response = session.post(
                message_endpoint,
                json=request_data,
                headers={"Content-Type": "application/json"},
                timeout=10
            )
            
            print(f"Response status: {message_response.status_code}")
            
            if message_response.status_code == 200:
                print(f"Success! Response: {message_response.text}")
                break
            else:
                print(f"Error: {message_response.text}")
                # Wait a bit before trying the next format
                time.sleep(1)
        except Exception as e:
            print(f"Error sending message: {e}")
    
    # Keep listening for SSE events after sending the request
    print("\nListening for events from the server...")
    try:
        for line in sse_response.iter_lines():
            if line:
                decoded_line = line.decode('utf-8')
                print(f"Received: {decoded_line}")
                
                # If it's a data line, try to parse JSON
                if decoded_line.startswith('data:'):
                    try:
                        data = json.loads(decoded_line[5:])
                        print(f"Parsed JSON: {json.dumps(data, indent=2)}")
                    except json.JSONDecodeError:
                        pass
    except KeyboardInterrupt:
        print("Connection closed by user")
    except Exception as e:
        print(f"Error reading events: {e}")
    finally:
        sse_response.close()

if __name__ == "__main__":
    connect_and_list_tools() 