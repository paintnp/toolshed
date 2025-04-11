"use client"

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Navigation } from "@/components/Navigation";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Server error:", error);
  }, [error]);

  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
      <Navigation />
      <main className="flex-1 container mx-auto p-6">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8">
          <div className="p-6 max-w-2xl mx-auto text-center">
            <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
              Something went wrong!
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              {error.message || "An unexpected error occurred"}
            </p>
            <div className="flex justify-center gap-4">
              <Button onClick={reset}>
                Try Again
              </Button>
              <Link href="/servers">
                <Button variant="outline">
                  Back to Servers
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 