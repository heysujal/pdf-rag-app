import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs'

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PDF Chat",
  description: "Upload PDFs and ask questions. Powered by your documents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
     <ClerkProvider>
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
          <header className="flex justify-end items-center p-4 gap-4 h-16">
            <SignedIn>
              <UserButton />
            </SignedIn>
          </header>
          <SignedIn>
              {children}
          </SignedIn>
          <SignedOut>
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
              <h2 className="text-xl font-semibold text-foreground">PDF Chat</h2>
              <p className="max-w-sm text-muted-foreground text-sm">
                Sign in to upload PDFs and ask questions about your documents.
              </p>
              <div className="flex gap-3">
                <SignInButton mode="modal">
                  <button className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    Sign up
                  </button>
                </SignUpButton>
              </div>
            </div>
          </SignedOut>
      </body>
    </html>
    </ClerkProvider>
  );
}
