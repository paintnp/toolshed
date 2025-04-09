'use client';

import { Navigation } from "@/components/Navigation";
import { SearchBar } from "@/components/SearchBar";
import { AddMCPServerDialog } from "../components/AddMCPServerDialog";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  
  const handleAddSuccess = () => {
    // Navigate to servers page after successful add
    router.push('/servers');
  };
  
  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
      <Navigation />
      <main className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="max-w-3xl w-full text-center space-y-8">
          <h1 className="text-5xl font-bold tracking-tight">
            Welcome to ToolShed
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300">
            Discover and test MCP Servers to find the right tools for your projects
          </p>
          
          <div className="w-full flex justify-center mt-8">
            <SearchBar />
          </div>
          
          <div className="flex justify-center mt-4">
            <AddMCPServerDialog onSuccess={handleAddSuccess} />
          </div>
        </div>
      </main>
      <footer className="py-6 text-center text-gray-500">
        <p>© {new Date().getFullYear()} ToolShed. All rights reserved.</p>
      </footer>
    </div>
  );
}
