import { NextRequest, NextResponse } from 'next/server';
import { getServer, saveServer } from '@/lib/db/dynamodb';
import { getValidationStatus } from '@/lib/aws/fargate';

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

    // If no task ARN, it means validation hasn't started or it's an old record
    if (!serverRecord.taskArn) {
      return NextResponse.json({
        success: true,
        status: serverRecord.status || 'UNKNOWN',
        verified: serverRecord.verified,
        message: 'Server has no active validation pipeline',
        serverId
      });
    }

    // Check status from Step Functions
    const statusResult = await getValidationStatus(serverRecord.taskArn);
    
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
      sfnStatus: statusResult.status,
      verified: serverRecord.verified,
      message: `Validation pipeline status: ${statusResult.status}`,
      serverId,
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