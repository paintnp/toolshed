import { NextRequest, NextResponse } from 'next/server';
import { crawlMCPServers } from '@/lib/github/crawler';

/**
 * API route to crawl GitHub for MCP server repositories
 * GET /api/crawl?query=topic:mcp&maxResults=50
 */
export async function GET(request: NextRequest) {
  try {
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('query') || undefined;
    const maxResults = searchParams.get('maxResults') ? parseInt(searchParams.get('maxResults')!) : undefined;
    
    // Crawl GitHub repositories
    const results = await crawlMCPServers(query, maxResults);
    
    // Return results
    return NextResponse.json(results);
  } catch (error) {
    console.error('Error in crawler API route:', error);
    return NextResponse.json(
      { error: 'Failed to crawl GitHub repositories' },
      { status: 500 }
    );
  }
} 