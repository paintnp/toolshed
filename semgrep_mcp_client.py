import asyncio
import httpx
import json
from urllib.parse import urlparse, parse_qs

async def main():
    # Define the server URL
    server_url = "http://34.226.219.58:8000/sse"
    
    print(f"Connecting to SSE endpoint: {server_url}")
    
    # First connect to the SSE endpoint to get the session ID
    async with httpx.AsyncClient() as client:
        # Open the SSE connection
        async with client.stream("GET", server_url, headers={"Accept": "text/event-stream"}) as response:
            # Process the SSE events
            session_id = None
            messages_endpoint = None
            endpoint_event_found = False
            
            # Read the stream line by line
            async for line in response.aiter_lines():
                print(f"Received: {line}")
                
                # Look for the endpoint event
                if line.startswith("event: endpoint"):
                    endpoint_event_found = True
                    continue
                
                # After finding the endpoint event, look for the data line
                if endpoint_event_found and line.startswith("data: "):
                    endpoint_url = line[6:].strip()  # Remove "data: " prefix
                    print(f"Found endpoint URL: {endpoint_url}")
                    
                    # Parse the URL to get the session ID
                    parsed_url = urlparse(endpoint_url)
                    query_params = parse_qs(parsed_url.query)
                    if "session_id" in query_params:
                        session_id = query_params["session_id"][0]
                        messages_endpoint = f"http://34.226.219.58:8000{endpoint_url}"
                        print(f"Found session ID: {session_id}")
                        break
    
    if not session_id:
        print("Failed to get session ID")
        return
    
    # Now that we have a session ID, send a request to get the list of tools
    print(f"Sending request to messages endpoint: {messages_endpoint}")
    
    # Prepare the request payload
    request_id = "tool-list-request"
    payload = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "list_tools"
    }
    
    # Send the request
    async with httpx.AsyncClient() as client:
        response = await client.post(
            messages_endpoint,
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        print(f"Response status code: {response.status_code}")
        print(f"Response content: {response.text}")
        
        # If it's a 202 Accepted response, we need to listen for the actual response via SSE
        if response.status_code == 202:
            print("Request accepted, waiting for response via SSE...")
            
            # Connect to the SSE endpoint again to get the response
            async with client.stream("GET", server_url, headers={"Accept": "text/event-stream"}) as sse_response:
                # Keep track of response found
                response_found = False
                max_wait_time = 30  # seconds
                start_time = asyncio.get_event_loop().time()
                
                # Read the stream
                async for line in sse_response.aiter_lines():
                    # Check for timeout
                    current_time = asyncio.get_event_loop().time()
                    if current_time - start_time > max_wait_time:
                        print(f"Timeout after {max_wait_time} seconds")
                        break
                    
                    print(f"SSE: {line}")
                    
                    # Look for data lines
                    if line.startswith("data: "):
                        try:
                            # Extract the JSON data
                            data_json = line[6:]  # Remove "data: " prefix
                            data = json.loads(data_json)
                            
                            # Check if this is a response to our request
                            if "id" in data and data["id"] == request_id:
                                print("\nFound response to our request:")
                                print(json.dumps(data, indent=2))
                                
                                # Process tools if present
                                if "result" in data and "tools" in data["result"]:
                                    print("\nAvailable tools:")
                                    for tool in data["result"]["tools"]:
                                        name = tool.get("name", "Unknown")
                                        desc = tool.get("description", "No description")
                                        print(f"- {name}: {desc}")
                                response_found = True
                                break
                        except json.JSONDecodeError:
                            # Not a JSON line
                            pass
                    
                    # For ping events, just log and continue
                    if line.startswith(": ping"):
                        continue
                
                if not response_found:
                    print("Did not receive a response to our request")

# Run the asyncio event loop
if __name__ == "__main__":
    asyncio.run(main()) 