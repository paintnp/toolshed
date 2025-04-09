import { NextResponse } from "next/server";
import { stopContainer } from "@/lib/aws/fargate";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskArn = searchParams.get("taskArn");
    const reason = searchParams.get("reason") || "Task stopped via API";

    if (!taskArn) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: taskArn" },
        { status: 400 }
      );
    }

    // Stop the Fargate container
    const result = await stopContainer(taskArn, reason);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "Container stopped successfully" });
  } catch (error) {
    console.error("Error stopping container:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
} 