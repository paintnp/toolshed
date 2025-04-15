import { NextRequest, NextResponse } from 'next/server';
import { getServer, getServerByFullName, saveServer } from '@/lib/db/dynamodb';
import { launchPlayground } from '@/lib/aws/playground';

/**
 * POST /api/servers/[id]/playground
 * Launch a playground environment for the specified server
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const paramsObject = await params;
    const serverId = paramsObject.id;
    
    console.log(`Launching playground for server: ${serverId}`);
    
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
    
    // Check if the server has been verified and has an image URI
    if (!server.verified) {
      return NextResponse.json(
        { error: 'Server has not been verified. Please verify the server first.' },
        { status: 400 }
      );
    }
    
    if (!server.imageUri) {
      return NextResponse.json(
        { error: 'No Docker image available for this server. Please verify the server to build an image.' },
        { status: 400 }
      );
    }
    
    // Log the image URI that we'll use
    console.log(`Using image URI for server ${server.ServerId}: ${server.imageUri}`);
    
    // For debugging, print relevant server info
    if (server.imageTag) {
      console.log(`Server has image tag: ${server.imageTag}`);
    }
    
    // Launch the playground environment
    const result = await launchPlayground(
      server.imageUri,
      server.ServerId
    );
    
    // Handle errors
    if (!result.success) {
      console.error(`Failed to launch playground for ${server.ServerId}:`, result.error);
      return NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Failed to launch playground environment'
        },
        { status: 500 }
      );
    }
    
    // Save the task ARN to the server record in DynamoDB
    if (result.taskArn) {
      console.log(`Updating server record with taskArn: ${result.taskArn}`);
      try {
        // Update the server record with the taskArn
        await saveServer({
          ...server,
          taskArn: result.taskArn,
          status: 'RUNNING_PLAYGROUND',
          lastUpdated: Date.now()
        });
      } catch (dbError) {
        console.error(`Warning: Failed to update server record with taskArn: ${dbError}`);
        // Continue even if DB update fails - we still launched the playground
      }
    }
    
    // Return success with task ARN for tracking
    return NextResponse.json({
      success: true,
      taskArn: result.taskArn,
      message: 'Playground environment is being launched',
      server: {
        id: server.ServerId,
        name: server.name || server.fullName,
        imageUri: server.imageUri
      }
    });
  } catch (error) {
    console.error(`Error launching playground for server ${params.id}:`, error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to launch playground'
      },
      { status: 500 }
    );
  }
} 