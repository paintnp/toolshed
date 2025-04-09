import { NextRequest, NextResponse } from 'next/server';
import { verifyMCPServerFromGitHub } from '@/lib/verification/tester';
import { getServer } from '@/lib/db/dynamodb';

/**
 * POST /api/mcp/add
 * Add a new MCP server by GitHub repository URL
 */
export async function POST(req: NextRequest) {
  try {
    const { repoFullName } = await req.json();

    if (!repoFullName) {
      return NextResponse.json(
        { verified: false, message: 'GitHub repository name is required' },
        { status: 400 }
      );
    }

    // Check if server already exists
    const existingServer = await getServer(repoFullName);
    if (existingServer && existingServer.verified) {
      return NextResponse.json({
        verified: true,
        message: 'Server already verified and added',
        details: existingServer
      });
    }

    // Start verification pipeline using the existing function
    console.log(`Starting verification for ${repoFullName}`);
    const verificationResult = await verifyMCPServerFromGitHub(repoFullName);

    // If verification failed, return error
    if (!verificationResult.verified) {
      return NextResponse.json({
        verified: false,
        message: verificationResult.message || 'Verification failed',
      });
    }

    // Return success
    return NextResponse.json({
      verified: true,
      message: 'MCP Server verified and added successfully',
      details: verificationResult.details,
    });
  } catch (error) {
    console.error('Error adding MCP server:', error);
    return NextResponse.json(
      {
        verified: false,
        message: `Error processing request: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    );
  }
} 