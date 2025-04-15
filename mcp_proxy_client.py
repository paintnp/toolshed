import requests
import json
import sys
import time

def use_toolshed_proxy(server_id, endpoint_path, method="GET", data=None):
    """
    Use the ToolShed MCP proxy endpoint to communicate with the MCP server
    
    Args:
        server_id: The server ID (e.g. 'semgrep/mcp')
        endpoint_path: The path on the MCP server (e.g. '/sse', '/tools')
        method: HTTP method to use (GET, POST)
        data: Data to send for POST requests
    """
    # ToolShed proxy endpoint
    proxy_url = f"http://localhost:3000/api/servers/{server_id}/mcp-proxy"
    
    # Construct the MCP server endpoint URL (will be determined by the proxy)
    server_endpoint = f"http://SERVER_IP:8000{endpoint_path}"
    
    # Create the proxy request body
    proxy_request = {
        "endpoint": server_endpoint,
        "method": method
    }
    
    if data:
        proxy_request["data"] = data
    
    print(f"Sending {method} request to {server_endpoint} via ToolShed proxy")
    
    try:
        # Make the proxy request
        response = requests.post(
            proxy_url,
            json=proxy_request,
            headers={"Content-Type": "application/json"}
        )
        
        print(f"Proxy response status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"Success! MCP server returned status: {result.get('status')}")
            return result.get('data')
        else:
            print(f"Error: {response.text}")
            return None
            
    except Exception as e:
        print(f"Error using proxy: {str(e)}")
        return None

def test_mcp_endpoints(server_id):
    """Test various MCP server endpoints using the proxy"""
    endpoints = [
        "/",
        "/v1/tools",
        "/tools",
        "/list_tools",
        "/api/tools",
        "/mcp/v1/tools"
    ]
    
    for endpoint in endpoints:
        print(f"\nTesting endpoint: {endpoint}")
        result = use_toolshed_proxy(server_id, endpoint)
        if result:
            print(f"Response: {json.dumps(result, indent=2)[:200]}...")

    # Test SSE endpoint with POST
    print("\nTesting SSE endpoint with POST")
    request_id = f"req_{int(time.time())}"
    result = use_toolshed_proxy(
        server_id,
        "/sse",
        method="POST",
        data={"type": "tools/list", "id": request_id}
    )
    if result:
        print(f"Response: {json.dumps(result, indent=2)}")

if __name__ == "__main__":
    # Default to semgrep/mcp if no server ID provided
    server_id = sys.argv[1] if len(sys.argv) > 1 else "semgrep/mcp"
    
    print(f"Testing MCP server endpoints for {server_id} using ToolShed proxy")
    test_mcp_endpoints(server_id) 