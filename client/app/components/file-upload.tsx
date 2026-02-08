'use client';

import { Button } from '@/components/ui/button';
import { useUser } from '@clerk/nextjs';
import { FileText, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export function FileUpload() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !email) return;

    setFileName(file.name);
    setStatus('uploading');
    setStatusMessage('');

    const formData = new FormData();
    formData.append('pdfFile', file);
    formData.append('email', email);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upload/pdf`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = typeof data?.error === 'string' ? data.error : 'Upload failed';
        setStatus('error');
        setStatusMessage(data?.details ? `${msg}: ${data.details}` : msg);
        return;
      }

      setStatus('success');
      setStatusMessage(data?.message ?? 'PDF is being processed. You can ask questions once it\'s ready.');
    } catch {
      setStatus('error');
      setStatusMessage('Network error. Please try again.');
    } finally {
      e.target.value = '';
    }
  };

  if (!email) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center text-muted-foreground text-sm">
        Sign in to upload PDFs.
      </div>
    );
  }

  const isUploading = status === 'uploading';

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-2">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted">
            <FileText className="size-7 text-muted-foreground" aria-hidden />
          </div>
          <h2 className="font-semibold text-foreground">Upload PDF</h2>
          <p className="text-sm text-muted-foreground">
            Add a PDF to ask questions about it. Processing may take a moment.
          </p>
        </div>

        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileChange}
            disabled={isUploading}
            aria-label="Choose PDF file"
          />
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={openFilePicker}
            disabled={isUploading}
            className="w-full gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
                <span>Uploading…</span>
              </>
            ) : (
              <>
                <Upload className="size-4 shrink-0" aria-hidden />
                <span>{fileName ?? 'Choose PDF'}</span>
              </>
            )}
          </Button>

          {fileName && status !== 'idle' && (
            <p
              className={cn(
                'text-xs transition-opacity',
                status === 'success' && 'text-green-600 dark:text-green-400',
                status === 'error' && 'text-destructive'
              )}
              role="status"
            >
              {status === 'uploading'
                ? 'Sending…'
                : statusMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
