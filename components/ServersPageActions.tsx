'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AddMCPServerDialog } from '@/components/AddMCPServerDialog';

export function ServersPageActions() {
  const router = useRouter();
  
  const handleAddSuccess = () => {
    // Refresh the current page after a successful add
    router.refresh();
  };
  
  return (
    <div className="flex justify-between items-center mb-6">
      <div className="flex-1">
        <h1 className="text-3xl font-bold">All MCP Servers</h1>
      </div>
      
      <div className="flex items-center space-x-4">
        <AddMCPServerDialog onSuccess={handleAddSuccess} />
        <Link 
          href="/search" 
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          Search Servers
        </Link>
      </div>
    </div>
  );
} 