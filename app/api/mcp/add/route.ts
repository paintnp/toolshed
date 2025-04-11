import { NextRequest, NextResponse } from 'next/server';
import { getServer, saveServer, ServerRecord } from '@/lib/db/dynamodb';
import { startServerValidation } from '@/lib/aws/fargate';

/**
 * POST /api/mcp/add
 * Add a new MCP server by GitHub repository URL and start the validation pipeline
 */
export async function POST(req: NextRequest) {
  try {
    const { repoFullName } = await req.json();

    if (!repoFullName) {
      return NextResponse.json(
        { success: false, message: 'GitHub repository name is required' },
        { status: 400 }
      );
    }

    // Check if server already exists
    const existingServer = await getServer(repoFullName);
    
    // Create or update server record
    let serverRecord: ServerRecord;
    
    if (existingServer) {
      // Update existing record with "VERIFYING" status
      serverRecord = {
        ...existingServer,
        status: 'VERIFYING',
        lastUpdated: Date.now()
      };
    } else {
      // Create a new server record with basic information
      serverRecord = {
        ServerId: repoFullName,
        name: repoFullName.split('/')[1] || repoFullName,
        fullName: repoFullName,
        url: `https://github.com/${repoFullName}`,
        discoveredAt: Date.now(),
        verified: false,
        status: 'VERIFYING'
      };
    }

    // Save the initial/updated server record to DynamoDB
    await saveServer(serverRecord);
    
    console.log(`Starting validation pipeline for ${repoFullName}`);
    
    // Check if running in development environment without AWS
    const isDevelopment = process.env.NODE_ENV === 'development';
    const hasValidStateMachine = Boolean(process.env.VALIDATION_STATE_MACHINE_ARN) && 
                               !process.env.VALIDATION_STATE_MACHINE_ARN.includes('123ABC');
    
    // Skip actual AWS validation in development mode if not properly configured
    if (isDevelopment && !hasValidStateMachine) {
      console.log('Running in development mode without valid AWS configuration. Simulating successful validation.');
      
      // Simulate a successful validation for development
      serverRecord.status = 'VERIFIED';
      serverRecord.verified = true;
      serverRecord.toolCount = 2;
      serverRecord.tools = [
        { name: 'example-tool-1', description: 'An example tool for testing' },
        { name: 'example-tool-2', description: 'Another example tool for testing' }
      ];
      serverRecord.lastUpdated = Date.now();
      serverRecord.lastTested = Date.now();
      
      // Save the updated record
      await saveServer(serverRecord);
      
      return NextResponse.json({
        success: true,
        message: 'Server added and verified successfully in development mode',
        serverId: serverRecord.ServerId,
        status: serverRecord.status
      });
    }
    
    // Start the validation pipeline using the Step Functions state machine
    const validationResult = await startServerValidation(serverRecord);
    
    // If starting the validation pipeline failed, update status and return error
    if (!validationResult.success) {
      serverRecord.status = 'ERROR';
      serverRecord.lastUpdated = Date.now();
      await saveServer(serverRecord);
      
      return NextResponse.json({
        success: false,
        message: validationResult.error || 'Failed to start validation pipeline',
        serverId: serverRecord.ServerId
      }, { status: 500 });
    }
    
    // Update server record with execution ARN
    serverRecord.status = 'BUILDING';
    serverRecord.taskArn = validationResult.executionArn; // Store the execution ARN
    serverRecord.lastUpdated = Date.now();
    await saveServer(serverRecord);

    // Return success
    return NextResponse.json({
      success: true,
      message: 'Validation pipeline started successfully',
      serverId: serverRecord.ServerId,
      status: serverRecord.status,
      executionArn: validationResult.executionArn
    });
  } catch (error) {
    console.error('Error adding MCP server:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Error processing request: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    );
  }
} 