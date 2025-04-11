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
    // Fix: Await the params object before accessing its properties
    const paramsObject = await params;
    
    // The ID will already be URL-decoded by Next.js route handling
    const serverId = paramsObject.id;
    
    // Try to get server by ID
    let server = await getServer(serverId);
    
    // If not found, try to get by full name (for backward compatibility)
    if (!server) {
      server = await getServerByFullName(serverId);
    }
    
    if (!server) {
      return NextResponse.json(
        { error: 'Server not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(server);
  } catch (error) {
    console.error(`Error fetching server ${serverId}:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch server' },
      { status: 500 }
    );
  }
} 