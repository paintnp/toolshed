import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

/**
 * GET /api/clear-cache
 * Clear the Next.js cache for various pages
 */
export async function GET(req: NextRequest) {
  try {
    // Revalidate the servers page
    revalidatePath('/servers', 'page');
    
    // Revalidate the API route that fetches servers
    revalidatePath('/api/servers', 'page');
    
    // Revalidate individual server pages (this is a pattern match)
    revalidatePath('/servers/[id]', 'page');
    
    return NextResponse.json({
      success: true,
      message: 'Cache cleared successfully',
      clearedPaths: ['/servers', '/api/servers', '/servers/[id]']
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to clear cache',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 