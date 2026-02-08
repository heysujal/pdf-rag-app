import { FileUpload } from './components/file-upload';
import { QueryInput } from './components/query-input';

export default function Home() {
  return (
    <main className="flex h-[calc(100vh-4rem)] min-h-0 w-full">
      <aside className="flex w-full shrink-0 flex-col border-r border-border bg-background sm:max-w-[320px]">
        <div className="border-b border-border px-4 py-3">
          <h1 className="font-semibold text-foreground">PDF Chat</h1>
          <p className="text-xs text-muted-foreground">Upload & ask</p>
        </div>
        <div className="flex-1 min-h-0">
          <FileUpload />
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Chat">
        <QueryInput />
      </section>
    </main>
  );
}
