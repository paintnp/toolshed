import { NextResponse } from "next/server";
import { checkContainerStatus } from "@/lib/aws/fargate";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskArn = searchParams.get("taskArn");

    if (!taskArn) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: taskArn" },
        { status: 400 }
      );
    }

    // Check the Fargate container status
    const result = await checkContainerStatus(taskArn);

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      running: result.running,
      status: result.status
    });
  } catch (error) {
    console.error("Error checking container status:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
} 