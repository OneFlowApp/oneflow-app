import { type ReactNode } from "react";
import { ClassReviewPrompt } from "./ClassReviewPrompt";
import { PracticeSharePrompt } from "./PracticeSharePrompt";
import { WhatsAppFab } from "./WhatsAppFab";
import { useAuth } from "@/contexts/auth";
import { firstAdminPath } from "@/lib/roleAccess";
import logo from "@/assets/oneflow-logo.webp";

export function AppShell({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  // Any role with at least one admin page can switch to the Admin Dashboard.
  const adminPath = firstAdminPath(profile);
  const showAdminCta = adminPath != null;

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-background">
      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden pb-with-bottom-nav">
        <header className="safe-top z-30 flex shrink-0 flex-col border-b border-border/60 bg-background/95 backdrop-blur">
          {showAdminCta && (
            <div className="border-b border-primary/20 bg-primary-soft/40 px-4 py-2">
              <button
                type="button"
                onClick={() => window.location.assign(adminPath ?? "/admin")}
                className="w-full rounded-lg border border-primary/25 bg-background/80 py-2 text-center text-xs font-semibold text-primary shadow-sm transition-colors hover:bg-primary/10"
              >
                Admin Dashboard
              </button>
            </div>
          )}
          <div className="flex items-center justify-center px-5 pb-3 pt-2">
            <img src={logo} alt="One Flow" className="h-9 w-auto" />
          </div>
        </header>
        <div
          data-customer-scroll
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-touch"
        >
          {children}
        </div>
      </div>
      <ClassReviewPrompt />
      <PracticeSharePrompt />
      <WhatsAppFab />
    </div>
  );
}
