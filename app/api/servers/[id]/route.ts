import { NextResponse } from "next/server";
import { serverDetails } from "@/lib/data/servers";

export async function GET(_request: Request, context: { params: { id: string } }) {
  // Get id from context params
  const id = context.params.id;

  // Find the server by ID
  const server = serverDetails[id];

  // If server not found, return 404
  if (!server) {
    return NextResponse.json(
      { error: "Server not found" },
      { status: 404 }
    );
  }

  // Return the server details
  return NextResponse.json(server);
} 