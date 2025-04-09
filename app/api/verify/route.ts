import { NextRequest, NextResponse } from 'next/server';
import { verifyServer, verifyServers, MCPRepository } from '@/lib/verification/tester';

/**
 * API route to verify a single MCP server
 * POST /api/verify
 * Body: MCPRepository object
 */
export async function POST(request: NextRequest) {
  try {
    // Get server metadata from request body
    const server = await request.json();
    
    if (!server.fullName) {
      return NextResponse.json(
        { error: 'Invalid server metadata: missing fullName' },
        { status: 400 }
      );
    }
    
    // Verify the server
    const verifiedServer = await verifyServer(server);
    
    // Return updated server metadata
    return NextResponse.json(verifiedServer);
  } catch (error) {
    console.error('Error in server verification API route:', error);
    return NextResponse.json(
      { error: 'Failed to verify MCP server' },
      { status: 500 }
    );
  }
}

/**
 * API route to verify multiple MCP servers
 * GET /api/verify?servers=fullName1,fullName2
 * or
 * GET /api/verify/all - to verify all servers from crawler results (not implemented yet)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const serversParam = searchParams.get('servers');
    
    if (!serversParam) {
      return NextResponse.json(
        { error: 'Missing servers parameter. Use ?servers=fullName1,fullName2' },
        { status: 400 }
      );
    }
    
    // Parse server names
    const serverNames = serversParam.split(',');
    
    // Create minimal server objects for verification
    const servers: MCPRepository[] = serverNames.map(fullName => ({
      id: fullName,
      name: fullName.split('/')[1] || fullName,
      fullName: fullName,
      description: null,
      language: null,
      url: `https://github.com/${fullName}`,
      stars: 0,
      forks: 0,
      topics: [],
      lastUpdated: '',
      discoveredAt: Date.now(),
      verified: false
    }));
    
    // Verify all servers
    const verifiedServers = await verifyServers(servers);
    
    // Return updated server metadata
    return NextResponse.json({
      verified: verifiedServers.length,
      succeeded: verifiedServers.filter(s => s.verified).length,
      servers: verifiedServers
    });
  } catch (error) {
    console.error('Error in server verification API route:', error);
    return NextResponse.json(
      { error: 'Failed to verify MCP servers' },
      { status: 500 }
    );
  }
} 