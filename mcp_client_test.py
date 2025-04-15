import asyncio
import httpx
import traceback
import sys

async def try_server(server_url):
    print(f"\n=== Trying MCP server at {server_url} ===")
    
    # Create a httpx client session
    async with httpx.AsyncClient(timeout=5.0) as client:
        # First, let's try to just ping the server
        try:
            print(f"Basic connection test to {server_url}")
            response = await client.get(server_url)
            print(f"Response status: {response.status_code}")
            print(f"Response: {response.text[:200]}...")  # Print first 200 chars
        except Exception as e:
            print(f"Error with basic connection: {str(e)}")
            return
            
        # Try various endpoints
        endpoints = [
            "/", "/v1/tools", "/tools", "/list_tools", "/api/tools", 
            "/mcp/v1/tools", "/mcp/tools", "/api/v1/tools"
        ]
        
        for endpoint in endpoints:
            try:
                print(f"\nTrying endpoint: {endpoint}")
                response = await client.get(f"{server_url}{endpoint}")
                print(f"Response status: {response.status_code}")
                if response.status_code == 200:
                    print(f"Success! Response: {response.text[:150]}...")  # First 150 chars
            except Exception as e:
                print(f"Error with endpoint {endpoint}: {str(e)}")

        # Try SSE endpoint
        try:
            print("\nTrying SSE endpoint...")
            response = await client.get(f"{server_url}/sse")
            print(f"Response status: {response.status_code}")
            print(f"Response headers: {response.headers}")
            print(f"Response: {response.text[:150]}...")
        except Exception as e:
            print(f"Error with SSE endpoint (GET): {str(e)}")
        
        try:
            print("\nTrying POST to SSE endpoint...")
            response = await client.post(
                f"{server_url}/sse",
                json={"type": "tools/list"}
            )
            print(f"Response status: {response.status_code}")
            print(f"Response: {response.text[:150]}...")
        except Exception as e:
            print(f"Error with SSE endpoint (POST): {str(e)}")

async def main():
    # IP addresses from the logs
    server_urls = [
        "http://98.80.135.20:8000",  # Latest IP from logs
        "http://34.226.219.58:8000"  # Previous IP from logs
    ]
    
    for url in server_urls:
        try:
            await try_server(url)
        except Exception as e:
            print(f"Unhandled error testing {url}: {str(e)}")
            traceback.print_exc()

# Run the asynchronous main function
if __name__ == "__main__":
    asyncio.run(main()) 