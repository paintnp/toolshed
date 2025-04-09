"use client";

import Link from "next/link";

export function Navigation() {
  return (
    <nav className="flex items-center justify-between w-full max-w-7xl mx-auto px-4 py-4">
      <Link href="/" className="text-xl font-bold">
        ToolShed
      </Link>
      <div className="flex gap-6">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <Link href="/playground" className="hover:underline">
          Playground
        </Link>
        <Link href="/api-access" className="hover:underline">
          API Access
        </Link>
      </div>
    </nav>
  );
} 