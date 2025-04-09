import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100 dark:bg-slate-900">
      <main className="flex flex-col items-center justify-center p-8 space-y-6">
        <h1 className="text-4xl font-bold text-center">
          Next.js + Tailwind CSS + shadcn/ui
        </h1>
        <p className="text-center text-lg">
          Your setup is working correctly!
        </p>
        <Button className="mt-4">Click me</Button>
      </main>
    </div>
  );
}
