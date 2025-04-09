import Link from "next/link";
import { Navigation } from "@/components/Navigation";
import { ServersPageActions } from "@/components/ServersPageActions";

// This function will fetch data from our API route
async function getServers() {
  // Use the absolute URL in production, relative URL in development
  const host = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";
  
  const res = await fetch(`${host}/api/servers`);
  
  if (!res.ok) {
    throw new Error("Failed to fetch servers");
  }
  
  return res.json();
}

export default async function ServersPage() {
  const { servers } = await getServers();
  
  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
      <Navigation />
      <main className="flex-1 container mx-auto p-6">
        <ServersPageActions />
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((server: any) => (
            <Link 
              href={`/servers/${encodeURIComponent(server.ServerId)}`} 
              key={server.ServerId}
              className="block hover:scale-[1.02] transition-transform"
            >
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 h-full border border-transparent hover:border-primary">
                <h2 className="text-xl font-semibold mb-2">{server.name}</h2>
                <p className="text-gray-600 dark:text-gray-300 mb-3">{server.description}</p>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-900/30 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                    {server.language || 'Unknown'}
                  </span>
                  <div className="flex gap-1">
                    {server.topics && server.topics.slice(0, 2).map((tag: string) => (
                      <span 
                        key={tag} 
                        className="inline-flex items-center rounded-md bg-gray-50 dark:bg-gray-700 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
} 