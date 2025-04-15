import { NextRequest, NextResponse } from 'next/server';
import {
  ECSClient,
  DescribeTasksCommand
} from "@aws-sdk/client-ecs";
import { getPlaygroundStatus } from '@/lib/aws/playground';
import { getServer, saveServer } from '@/lib/db/dynamodb';

// Configure ECS client
const ecsClient = new ECSClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const DEFAULT_CONFIG = {
  cluster: process.env.PLAYGROUND_CLUSTER || process.env.AWS_ECS_CLUSTER || 'ToolShedCluster',
};

/**
 * GET /api/servers/[id]/playground/status
 * Get the status of a playground environment
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const serverId = await params.id;
    const { searchParams } = new URL(request.url);
    const taskArn = searchParams.get('taskArn');
    
    if (!taskArn) {
      return NextResponse.json(
        { error: 'Missing required parameter: taskArn' },
        { status: 400 }
      );
    }
    
    // Get playground environment status
    const status = await getPlaygroundStatus(taskArn);
    
    // If running with an endpoint, update the server record
    if (status.success && status.status === 'RUNNING' && status.endpoint) {
      try {
        // Get the server record
        const server = await getServer(serverId);
        
        if (server) {
          console.log(`Server ${serverId} endpoint before update:`, server.endpoint);
          
          let endpointNote = status.endpoint;
          if (status.isPrivateEndpoint) {
            console.warn(`Using private IP for ${serverId}: ${status.endpoint} - this will only be accessible within AWS network`);
            endpointNote = `${status.endpoint} (private IP - may only be accessible within AWS network)`;
          } else {
            console.log(`Using public IP for ${serverId}: ${status.endpoint}`);
          }
          
          if (!server.endpoint || server.endpoint.length === 0) {
            // Update with the endpoint information
            await saveServer({
              ...server,
              endpoint: [endpointNote], // Store as array for future expansion
              lastUpdated: Date.now()
            });
            console.log(`Updated server ${serverId} with endpoint: ${endpointNote}`);
          } else {
            // Check if current endpoint differs from stored endpoint
            const storedEndpoint = server.endpoint[0] || '';
            if (!storedEndpoint.startsWith(status.endpoint)) {
              console.log(`Endpoint changed from ${storedEndpoint} to ${endpointNote}, updating`);
              await saveServer({
                ...server,
                endpoint: [endpointNote],
                lastUpdated: Date.now()
              });
            } else {
              console.log(`Server ${serverId} already has correct endpoint: ${JSON.stringify(server.endpoint)}`);
            }
          }
        }
      } catch (dbError) {
        // Log but don't fail the request
        console.error(`Warning: Failed to update server record with endpoint: ${dbError}`);
      }
    }
    
    // Add a note to the response if it's a private endpoint
    const responseStatus = { ...status };
    if (status.endpoint && status.isPrivateEndpoint) {
      responseStatus.privateEndpointNote = "This is a private IP address and may only be accessible within the AWS network";
    }
    
    // Remove isPrivateEndpoint from the response to maintain backward compatibility
    delete responseStatus.isPrivateEndpoint;
    
    return NextResponse.json(responseStatus);
  } catch (error) {
    console.error('Error checking playground status:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check playground status'
      },
      { status: 500 }
    );
  }
} 