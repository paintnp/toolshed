import { NextRequest, NextResponse } from 'next/server';
import { getServer, saveServer } from '@/lib/db/dynamodb';
import { getValidationStatus } from '@/lib/aws/fargate';
import { checkContainerStatus } from '@/lib/aws/fargate';

/**
 * GET /api/mcp/status?serverId=owner/repo
 * Check the status of a validation pipeline for a server
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const serverId = searchParams.get('serverId');

    if (!serverId) {
      return NextResponse.json(
        { success: false, message: 'Server ID is required' },
        { status: 400 }
      );
    }

    // Get server record from database
    const serverRecord = await getServer(serverId);
    
    if (!serverRecord) {
      return NextResponse.json(
        { success: false, message: 'Server not found' },
        { status: 404 }
      );
    }

    // Prioritize executionArn if it exists, otherwise use taskArn
    const executionArn = serverRecord.executionArn;
    const taskArn = serverRecord.taskArn;
    
    // Check if taskArn is actually a Step Functions execution ARN (this can happen in older records)
    const isTaskArnActuallyExecution = taskArn && 
      taskArn.includes(':states:') && 
      taskArn.includes(':execution:');
    
    // If we have an executionArn already, use that, otherwise check if taskArn is actually an execution ARN
    const effectiveExecutionArn = executionArn || (isTaskArnActuallyExecution ? taskArn : undefined);
    const effectiveTaskArn = isTaskArnActuallyExecution ? undefined : taskArn;
    
    // If neither ARN exists, the validation hasn't started yet
    if (!effectiveExecutionArn && !effectiveTaskArn) {
      return NextResponse.json({
        success: true,
        status: serverRecord.status || 'UNKNOWN',
        verified: serverRecord.verified,
        message: 'Server has no active validation pipeline',
        serverId
      });
    }

    // Check the validation status
    let statusResult;
    let arnType = 'unknown';
    
    // Prioritize checking the Step Functions execution since it gives better status
    if (effectiveExecutionArn) {
      try {
        statusResult = await getValidationStatus(effectiveExecutionArn);
        arnType = 'execution';
      } catch (error) {
        console.error('Error checking execution status, falling back to task ARN:', error);
        // If execution ARN check fails, fall back to task ARN
        if (effectiveTaskArn) {
          const containerStatus = await checkContainerStatus(effectiveTaskArn);
          statusResult = {
            status: containerStatus.status || 'UNKNOWN',
            success: containerStatus.running,
            error: containerStatus.error
          };
          arnType = 'task';
        } else {
          statusResult = {
            status: 'ERROR',
            success: false,
            error: 'Failed to check execution status and no task ARN available'
          };
        }
      }
    } else if (effectiveTaskArn) {
      // If only task ARN is available, use that
      const containerStatus = await checkContainerStatus(effectiveTaskArn);
      statusResult = {
        status: containerStatus.status || 'UNKNOWN',
        success: containerStatus.running,
        error: containerStatus.error
      };
      arnType = 'task';
    }
    
    // Update server record if status has changed
    if (statusResult.status !== serverRecord.status) {
      // Map Step Functions status to our status codes
      let newStatus;
      if (statusResult.status === 'RUNNING') {
        newStatus = 'VALIDATING';
      } else if (statusResult.status === 'SUCCEEDED') {
        newStatus = 'VERIFIED';
      } else if (statusResult.status === 'FAILED') {
        newStatus = 'FAILED';
      } else {
        newStatus = statusResult.status;
      }
      
      // Update server record
      serverRecord.status = newStatus;
      serverRecord.lastUpdated = Date.now();
      
      // If validation completed successfully, update verified status
      if (statusResult.status === 'SUCCEEDED') {
        serverRecord.verified = true;
      }
      
      // Save updated record
      await saveServer(serverRecord);
    }

    // Return current status
    return NextResponse.json({
      success: true,
      status: serverRecord.status,
      statusDetails: statusResult.status,
      verified: serverRecord.verified,
      message: `Validation ${arnType === 'execution' ? 'pipeline' : 'task'} status: ${statusResult.status}`,
      serverId,
      arnType,
      error: statusResult.error
    });
  } catch (error) {
    console.error('Error checking validation status:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Error checking status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    );
  }
} 