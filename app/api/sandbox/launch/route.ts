import { NextResponse } from "next/server";
import { launchContainer } from "@/lib/aws/fargate";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const image = searchParams.get("image");
    const serverName = searchParams.get("server") || "Test MCP Server";

    if (!image) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: image" },
        { status: 400 }
      );
    }

    // Launch the container in AWS Fargate
    const result = await launchContainer({
      image,
      serverName,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error launching container:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
} 