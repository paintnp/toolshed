import asyncio
import json
import sys
import httpx
import requests
from sseclient import SSEClient

async def handle_message(message):
    """Handle a message from the server"""
    print(f"Message type: {message.event}")
    try:
        data = json.loads(message.data)
        print(f"Parsed data: {json.dumps(data, indent=2)}")
    except json.JSONDecodeError:
        print(f"Raw data: {message.data}")

async def send_message_to_endpoint(session_id, message_data):
    """Send a message to the messages endpoint"""
    endpoint = f"http://34.226.219.58:8000/messages/?session_id={session_id}"
    
    print(f"Sending to {endpoint}: {json.dumps(message_data, indent=2)}")
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                endpoint,
                json=message_data,
                timeout=10.0,
                headers={"Content-Type": "application/json"}
            )
            print(f"Message sent, status: {response.status_code}")
            if response.status_code == 200:
                try:
                    print(f"Response: {json.dumps(response.json(), indent=2)}")
                except json.JSONDecodeError:
                    print(f"Raw response: {response.text}")
            else:
                print(f"Error response: {response.text}")
        except Exception as e:
            print(f"Error sending message: {e}")

def connect_to_mcp():
    """Connect to the MCP server using SSE"""
    sse_url = "http://34.226.219.58:8000/sse"
    print(f"Connecting to MCP server at {sse_url}")
    
    headers = {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
    }
    
    # Connect to the SSE endpoint
    response = requests.get(sse_url, headers=headers, stream=True)
    if response.status_code != 200:
        print(f"Failed to connect: {response.status_code} {response.reason}")
        return
        
    print(f"Connected with status {response.status_code}")
    print(f"Response headers: {dict(response.headers)}")
    
    client = SSEClient(response)
    
    # Process initial connection
    session_id = None
    
    # Get the first message which should contain the session_id
    for event in client.events():
        if event.event == "endpoint":
            # Extract session ID from the endpoint URL
            endpoint_url = event.data.strip()
            if "session_id=" in endpoint_url:
                session_id = endpoint_url.split("session_id=")[1]
                print(f"Connected with session ID: {session_id}")
                break
    
    if not session_id:
        print("Failed to get session ID")
        return
    
    # Test sending a tools/list request
    print(f"Sending tools/list request to session {session_id}")
    
    # Format the request according to the MCP protocol
    request_data = {
        "client_request": {
            "type": "tools/list",
            "id": "request-1"
        }
    }
    
    # Try alternative formats if the above doesn't work
    alternative_requests = [
        # Format 1: Direct request
        {
            "type": "tools/list",
            "id": "request-1"
        },
        # Format 2: Different property name
        {
            "request": {
                "type": "tools/list",
                "id": "request-1"
            }
        },
        # Format 3: Message format
        {
            "message": {
                "type": "tools/list",
                "id": "request-1"
            }
        }
    ]
    
    # Use asyncio to send the message while keeping the SSE connection open
    loop = asyncio.get_event_loop()
    
    # Send the primary request format
    loop.run_until_complete(send_message_to_endpoint(session_id, request_data))
    
    # Wait for response
    print("Waiting for response...")
    response_received = False
    timeout = 5  # seconds
    start_time = loop.time()
    
    while loop.time() - start_time < timeout:
        for event in client.events():
            if event.event != ":" and event.event != "endpoint":  # Skip ping and endpoint events
                print(f"Event received: {event.event}")
                loop.run_until_complete(handle_message(event))
                response_received = True
                break
        
        if response_received:
            break
        
        # Small delay to avoid CPU spinning
        loop.run_until_complete(asyncio.sleep(0.1))
    
    # If no response, try alternative formats
    if not response_received:
        print("No response received, trying alternative request formats...")
        
        for i, alt_request in enumerate(alternative_requests):
            print(f"\nTrying alternative format {i+1}...")
            loop.run_until_complete(send_message_to_endpoint(session_id, alt_request))
            
            # Wait for response
            print("Waiting for response...")
            start_time = loop.time()
            
            while loop.time() - start_time < timeout:
                for event in client.events():
                    if event.event != ":" and event.event != "endpoint":  # Skip ping and endpoint events
                        print(f"Event received: {event.event}")
                        loop.run_until_complete(handle_message(event))
                        response_received = True
                        break
                
                if response_received:
                    break
                
                # Small delay to avoid CPU spinning
                loop.run_until_complete(asyncio.sleep(0.1))
            
            if response_received:
                break
    
    # Continue reading events
    try:
        print("\nListening for all messages from the server...")
        for event in client.events():
            if event.event == "error":
                print(f"Error event: {event.data}")
                break
                
            if not event.event.startswith(':'):  # Skip ping events
                print(f"Event received: {event.event}")
                loop.run_until_complete(handle_message(event))
    except KeyboardInterrupt:
        print("Connection closed by user")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    connect_to_mcp() 