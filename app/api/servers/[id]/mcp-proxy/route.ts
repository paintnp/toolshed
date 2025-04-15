import { NextRequest, NextResponse } from 'next/server';
import { getServer } from '@/lib/db/dynamodb';
import axios from 'axios';

/**
 * POST /api/servers/[id]/mcp-proxy
 * Proxy requests to MCP server to avoid CORS issues
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { endpoint, method = 'GET', data } = body;
    
    if (!endpoint) {
      return NextResponse.json(
        { error: 'MCP server endpoint is required' },
        { status: 400 }
      );
    }
    
    // Get server to verify it exists
    const serverId = await params.id;
    const server = await getServer(serverId);
    if (!server) {
      return NextResponse.json(
        { error: 'Server not found' },
        { status: 404 }
      );
    }
    
    console.log(`Proxying ${method} request to MCP server at ${endpoint}`);
    
    try {
      let response;
      
      // Standard HTTP methods
      if (method === 'GET') {
        response = await axios.get(endpoint, { timeout: 10000 });
      } else if (method === 'POST') {
        response = await axios.post(endpoint, data, { 
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      } else if (method === 'HEAD') {
        response = await axios.head(endpoint, { timeout: 5000 });
      } else {
        return NextResponse.json(
          { error: 'Unsupported HTTP method' },
          { status: 400 }
        );
      }
      
      // Return the data from the response
      return NextResponse.json({
        success: true,
        data: response.data,
        status: response.status,
        headers: response.headers
      });
    } catch (error) {
      console.error('Error proxying request to MCP server:', error);
      
      // Return detailed error information
      const errorResponse: any = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      
      // Add axios error details if available
      if (axios.isAxiosError(error) && error.response) {
        errorResponse.status = error.response.status;
        errorResponse.statusText = error.response.statusText;
        errorResponse.data = error.response.data;
      }
      
      return NextResponse.json(
        errorResponse,
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error processing MCP proxy request:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
} 