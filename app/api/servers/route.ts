import { NextRequest, NextResponse } from 'next/server';
import { 
  listAllServers, 
  queryServersByName, 
  listVerifiedServers,
  tableExists 
} from '@/lib/db/dynamodb';

/**
 * GET /api/servers
 * Get a list of all servers, optionally filtered by name or query
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
    
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('query');
    const verifiedOnly = searchParams.get('verified') === 'true';
    
    let servers;
    
    // If query provided, search by name/description
    if (query) {
      servers = await queryServersByName(query);
      
      // Filter by verified status if requested
      if (verifiedOnly) {
        servers = servers.filter(server => server.verified);
      }
    } else if (verifiedOnly) {
      // If verified only, get only verified servers
      servers = await listVerifiedServers();
    } else {
      // Otherwise, get all servers
      servers = await listAllServers();
    }
    
    // Sort by stars (most popular first)
    servers.sort((a, b) => (b.stars || 0) - (a.stars || 0));
    
    return NextResponse.json({
      servers,
      total: servers.length
    });
  } catch (error) {
    console.error('Error fetching servers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch servers' },
      { status: 500 }
    );
  }
} 