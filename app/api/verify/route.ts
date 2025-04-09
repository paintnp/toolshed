import { NextRequest, NextResponse } from 'next/server';
import { verifyServer, verifyServers, MCPRepository } from '@/lib/verification/tester';
import { getServer, tableExists } from '@/lib/db/dynamodb';

/**
 * API route to verify a single MCP server
 * POST /api/verify
 * Body: MCPRepository object
 */
export async function POST(request: NextRequest) {
  try {
    // Check if DynamoDB table exists
    const hasTable = await tableExists();
    if (!hasTable) {
      return NextResponse.json(
        { error: 'Database not initialized. Please run setup script first.' },
        { status: 500 }
      );
    }
    
    // Get server metadata from request body
    const server = await request.json();
    
    if (!server.fullName) {
      return NextResponse.json(
        { error: 'Invalid server metadata: missing fullName' },
        { status: 400 }
      );
    }
    
    // Check if server exists in DB
    const existingServer = await getServer(server.fullName);
    
    // Use existing server data if available
    const serverToVerify: MCPRepository = existingServer ? {
      id: existingServer.ServerId,
      name: existingServer.name,
      fullName: existingServer.fullName,
      description: existingServer.description || null,
      language: existingServer.language || null,
      url: existingServer.url,
      stars: existingServer.stars || 0,
      forks: existingServer.forks || 0,
      topics: existingServer.topics || [],
      lastUpdated: existingServer.lastUpdated?.toString() || new Date().toISOString(),
      discoveredAt: existingServer.discoveredAt,
      verified: existingServer.verified,
      endpoint: existingServer.endpoint,
      toolCount: existingServer.toolCount,
      status: existingServer.status
    } : server;
    
    // Verify the server
    const verifiedServer = await verifyServer(serverToVerify, true);
    
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
 * GET /api/verify/all - to verify all servers from DynamoDB
 */
export async function GET(request: NextRequest) {
  try {
    // Check if DynamoDB table exists
    const hasTable = await tableExists();
    if (!hasTable) {
      return NextResponse.json(
        { error: 'Database not initialized. Please run setup script first.' },
        { status: 500 }
      );
    }
    
    const searchParams = request.nextUrl.searchParams;
    const serversParam = searchParams.get('servers');
    const path = request.nextUrl.pathname;
    
    let serversList: MCPRepository[] = [];
    
    // If the path is /api/verify/all, verify all servers in the database
    if (path === '/api/verify/all') {
      // This would be implemented to fetch all servers from DynamoDB
      // For now, return an error
      return NextResponse.json(
        { error: 'Verifying all servers is not yet implemented' },
        { status: 501 }
      );
    }
    
    if (!serversParam) {
      return NextResponse.json(
        { error: 'Missing servers parameter. Use ?servers=fullName1,fullName2' },
        { status: 400 }
      );
    }
    
    // Parse server names
    const serverNames = serversParam.split(',');
    
    // Get servers from DynamoDB
    for (const fullName of serverNames) {
      const server = await getServer(fullName);
      
      if (server) {
        serversList.push({
          id: server.ServerId,
          name: server.name,
          fullName: server.fullName,
          description: server.description || null,
          language: server.language || null,
          url: server.url,
          stars: server.stars || 0,
          forks: server.forks || 0,
          topics: server.topics || [],
          lastUpdated: server.lastUpdated?.toString() || '',
          discoveredAt: server.discoveredAt,
          verified: server.verified,
          endpoint: server.endpoint,
          toolCount: server.toolCount,
          status: server.status
        });
      } else {
        // If server not found, create a minimal placeholder
        serversList.push({
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
        });
      }
    }
    
    // Verify all servers
    const verifiedServers = await verifyServers(serversList, true);
    
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