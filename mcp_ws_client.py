#!/usr/bin/env python3
import json
import sys
import requests
import websocket
import time
import threading

def on_message(ws, message):
    """Handle incoming WebSocket messages"""
    print(f"Received message: {message[:150]}")
    try:
        data = json.loads(message)
        print(json.dumps(data, indent=2))
        
        # Check if this is a tools list response
        if 'type' in data and data['type'] == 'tools/list_result':
            if 'tools' in data:
                print("\nAvailable tools:")
                for tool in data['tools']:
                    print(f"- {tool['name']}: {tool['description']}")
            else:
                print("No tools found in response")
    except json.JSONDecodeError:
        print(f"Failed to parse message: {message}")

def on_error(ws, error):
    """Handle WebSocket errors"""
    print(f"Error: {error}")

def on_close(ws, close_status_code, close_msg):
    """Handle WebSocket connection close"""
    print(f"Connection closed: {close_status_code} - {close_msg}")

def on_open(ws):
    """Handle WebSocket connection open"""
    print("Connection opened")
    
    # Create a function to send the tools/list request
    def send_request():
        request_id = f"request_{int(time.time())}"
        request = {
            "type": "tools/list",
            "id": request_id
        }
        print(f"Sending tools/list request with id {request_id}")
        ws.send(json.dumps(request))
    
    # Start a thread to send the request
    threading.Thread(target=send_request).start()

def connect_to_server(server_url):
    """Connect to the MCP server using WebSocket"""
    # Convert HTTP URL to WebSocket URL if needed
    if server_url.startswith("http://"):
        ws_url = server_url.replace("http://", "ws://")
    elif server_url.startswith("https://"):
        ws_url = server_url.replace("https://", "wss://")
    else:
        ws_url = server_url
        
    # Add /ws path if it's not already there
    if not ws_url.endswith("/ws"):
        if ws_url.endswith("/"):
            ws_url += "ws"
        else:
            ws_url += "/ws"
            
    print(f"Connecting to WebSocket at {ws_url}")
    
    # Set up WebSocket connection
    ws = websocket.WebSocketApp(
        ws_url,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close
    )
    
    # Run the WebSocket connection
    ws.run_forever()

def test_http_endpoints(base_url):
    """Test various HTTP endpoints on the server"""
    # Remove any path components
    if '://' in base_url:
        parts = base_url.split('/')
        base = '/'.join(parts[:3])  # Keep protocol and domain
    else:
        base = base_url
        
    endpoints = [
        "/",
        "/ws",
        "/sse",
        "/api",
        "/tools",
        "/request",
        "/v1"
    ]
    
    print(f"Testing HTTP endpoints on {base}")
    for endpoint in endpoints:
        url = f"{base}{endpoint}"
        try:
            print(f"Trying {url}...")
            response = requests.get(url, timeout=5)
            print(f"Response: {response.status_code} {response.reason}")
            if response.status_code == 200:
                content = response.text[:100] + "..." if len(response.text) > 100 else response.text
                print(f"Content: {content}")
        except requests.exceptions.RequestException as e:
            print(f"Error: {e}")
        print("-" * 40)

if __name__ == "__main__":
    # Get the server URL from the command line or use default
    server_base = "http://34.226.219.58:8000"
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "--probe":
            test_http_endpoints(server_base)
        else:
            connect_to_server(sys.argv[1])
    else:
        print("Using default server URL")
        connect_to_server(server_base)