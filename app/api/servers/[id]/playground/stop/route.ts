import { NextRequest, NextResponse } from 'next/server';
import { stopPlayground } from '@/lib/aws/playground';
import { getServer, saveServer } from '@/lib/db/dynamodb';

/**
 * POST /api/servers/[id]/playground/stop
 * Stop a running playground environment
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const serverId = params.id;
    
    // Get the request body
    const body = await request.json();
    const { taskArn } = body;
    
    if (!taskArn) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: taskArn' },
        { status: 400 }
      );
    }
    
    // Get the server record
    const server = await getServer(serverId);
    if (!server) {
      console.warn(`Server ${serverId} not found when stopping playground`);
      // Continue with stop operation even if server record is not found
    }
    
    // Stop the playground environment
    const result = await stopPlayground(taskArn);
    
    // Clear the taskArn from the server record, even if stopping failed
    if (server) {
      try {
        await saveServer({
          ...server,
          taskArn: undefined,  // Remove taskArn
          status: 'VERIFIED',  // Reset status to VERIFIED (was RUNNING_PLAYGROUND)
          lastUpdated: Date.now()
        });
        console.log(`Cleared taskArn from server record for ${serverId}`);
      } catch (dbError) {
        console.error(`Warning: Failed to clear taskArn from server record: ${dbError}`);
        // Continue even if DB update fails
      }
    }
    
    if (!result.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Failed to stop playground environment'
        },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Playground environment is being stopped',
      taskArn
    });
  } catch (error) {
    console.error('Error stopping playground environment:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop playground environment'
      },
      { status: 500 }
    );
  }
} 