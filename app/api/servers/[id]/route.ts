import { NextRequest, NextResponse } from 'next/server';
import { getServer, getServerByFullName } from '@/lib/db/dynamodb';

/**
 * GET /api/servers/[id]
 * Get a single server by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const serverId = params.id;
    
    // URL decode the ID in case it contains slashes
    const decodedId = decodeURIComponent(serverId);
    
    // Try to get server by ID
    let server = await getServer(decodedId);
    
    // If not found, try to get by full name (for backward compatibility)
    if (!server) {
      server = await getServerByFullName(decodedId);
    }
    
    if (!server) {
      return NextResponse.json(
        { error: 'Server not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(server);
  } catch (error) {
    console.error(`Error fetching server ${params.id}:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch server' },
      { status: 500 }
    );
  }
} 