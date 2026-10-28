import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  ChevronLeft,
  ChevronRight,
  Eye,
  ImageIcon,
  Italic,
  Link as LinkIcon,
  Loader2,
  Mail,
  Save,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchBookableProfilesForCampaign,
  fetchCampaignRecipientEmails,
  fetchLegacyMemberAudienceStats,
  type BookableProfilePick,
  type CampaignRecipientFilter,
  type LegacyMemberAudienceStats,
} from "@/lib/campaignRecipients";
import { EMAIL_CAMPAIGN_TEMPLATES } from "@/lib/emailCampaignTemplates";
import { uploadEmailCampaignImage } from "@/lib/uploadEmailCampaignImage";
import { BOOKABLE_MEMBER_OR_FILTER } from "@/lib/bookableMembers";
import { ensureMarketingAdminAccess } from "@/lib/ensureMarketingAdminAccess";
import { getUser, supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

export const Route = createFileRoute("/admin/email")({
  beforeLoad: ({ location }) => ensureMarketingAdminAccess(location.pathname),
  head: () => ({ meta: [{ title: "Email Marketing — One Flow Admin" }] }),
  component: EmailPage,
});

const TZ = "Africa/Johannesburg";
const PAGE_SIZE = 20;

type CampaignRow = {
  id: string;
  subject: string;
  body_html: string;
  recipient_filter: Record<string, unknown>;
  sent_at: string | null;
  sent_count: number;
  status: "draft" | "sent";
  created_at: string;
};

type RecipientFilter = CampaignRecipientFilter;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function previewWrap(subject: string, html: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#a3b693;padding:28px;text-align:center;">
        <img src="/email/oneflow-logo.png" alt="One Flow" width="140" style="display:block;margin:0 auto;border:0;height:auto;" />
      </td></tr>
      <tr><td style="padding:32px;color:#2d2d2d;">
        <h2 style="font-size:20px;color:#a3b693;margin:0 0 16px;">${subject || ""}</h2>
        ${html}
      </td></tr>
      <tr><td style="padding:20px;background:#f5f5f0;text-align:center;color:#888;font-size:12px;">One Flow Yoga &amp; Wellness · Cape Town</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function profileLabel(p: BookableProfilePick): string {
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return name ? `${name} · ${p.email ?? ""}` : (p.email ?? "Member");
}

function EmailPage() {
  const [tab, setTab] = useState<string>("campaigns");
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);

  // List paging
  const [page, setPage] = useState(1);

  // Composer state
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [recipientType, setRecipientType] = useState<RecipientFilter>("all");
  const [roleValue, setRoleValue] = useState("customer");
  const [individualProfileId, setIndividualProfileId] = useState<string>("");
  const [specificProfileIds, setSpecificProfileIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [bookableProfiles, setBookableProfiles] = useState<BookableProfilePick[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [customerProfileCount, setCustomerProfileCount] = useState<number | null>(null);
  const [legacyAudience, setLegacyAudience] = useState<LegacyMemberAudienceStats | null>(null);
  const [sendProgress, setSendProgress] = useState<{
    done: number;
    total: number;
    failed: number;
  } | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Detail dialog
  const [detail, setDetail] = useState<CampaignRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("email_campaigns")
      .select("id, subject, body_html, recipient_filter, sent_at, sent_count, status, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not load campaigns"));
      setLoading(false);
      return;
    }
    setCampaigns((data ?? []) as CampaignRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .or(BOOKABLE_MEMBER_OR_FILTER);
      if (error) {
        console.error("email: customer profile count", error);
        setCustomerProfileCount(null);
        return;
      }
      setCustomerProfileCount(count ?? 0);
    })();
    void (async () => {
      try {
        setLegacyAudience(await fetchLegacyMemberAudienceStats());
      } catch (e) {
        console.error("email: legacy audience stats", e);
        setLegacyAudience(null);
      }
    })();
    void (async () => {
      try {
        const profiles = await fetchBookableProfilesForCampaign();
        setBookableProfiles(profiles);
      } catch (e) {
        console.error("email: bookable profiles load failed", e);
        setBookableProfiles([]);
      }
    })();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE));
  const pageRows = campaigns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const syncEditorHtml = () => {
    if (editorRef.current) setBodyHtml(editorRef.current.innerHTML);
  };

  const exec = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    syncEditorHtml();
  };

  const insertLink = () => {
    const url = prompt("URL");
    if (!url) return;
    exec("createLink", url);
  };

  const insertImageHtml = (url: string, alt: string) => {
    editorRef.current?.focus();
    const safeAlt = alt.replace(/"/g, "&quot;");
    const html = `<img src="${url}" alt="${safeAlt}" style="max-width:100%;height:auto;display:block;margin:12px 0;border-radius:8px;" />`;
    document.execCommand("insertHTML", false, html);
    syncEditorHtml();
  };

  const insertImageFromFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    setUploadingImage(true);
    try {
      const url = await uploadEmailCampaignImage(file);
      const alt = file.name.replace(/\.[^.]+$/, "").trim() || "Image";
      insertImageHtml(url, alt);
      toast.success("Image inserted");
    } catch (e) {
      console.error("email campaign image upload", e);
      toast.error(supabaseErrorMessage(e, "Could not upload image"));
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const handleEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void insertImageFromFile(file);
        return;
      }
    }
  };

  const recipientOptions = useMemo(
    () => ({
      filter: recipientType,
      roleValue,
      individualProfileId:
        recipientType === "role" && roleValue === "customer" && individualProfileId
          ? individualProfileId
          : null,
      specificProfileIds: recipientType === "specific" ? specificProfileIds : [],
    }),
    [recipientType, roleValue, individualProfileId, specificProfileIds],
  );

  const queryRecipients = useCallback(
    () => fetchCampaignRecipientEmails(recipientOptions),
    [recipientOptions],
  );

  const marketingSubject = subject.trim() || "An update from One Flow";

  async function invokeMarketingEmail(to: string): Promise<boolean> {
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: {
        to,
        template: "marketing",
        data: { subject: marketingSubject, body_html: bodyHtml },
      },
    });
    if (error) {
      console.error("send-email invoke failed", { to, error });
      return false;
    }
    const payload = data as { error?: unknown; success?: boolean } | null;
    if (payload?.error) {
      console.error("send-email returned error", { to, error: payload.error });
      return false;
    }
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await queryRecipients();
        if (!cancelled) setRecipientCount(list.length);
      } catch {
        if (!cancelled) setRecipientCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryRecipients]);

  const newCampaign = () => {
    setSubject("");
    setBodyHtml("");
    setRecipientType("all");
    setRoleValue("customer");
    setIndividualProfileId("");
    setSpecificProfileIds([]);
    setMemberSearch("");
    setDraftId(null);
    if (editorRef.current) editorRef.current.innerHTML = "";
    setTab("compose");
  };

  const applyTemplate = (templateId: string) => {
    const tpl = EMAIL_CAMPAIGN_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setSubject(tpl.subject);
    setBodyHtml(tpl.bodyHtml);
    if (editorRef.current) editorRef.current.innerHTML = tpl.bodyHtml;
  };

  const filteredProfiles = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return bookableProfiles;
    return bookableProfiles.filter((p) => profileLabel(p).toLowerCase().includes(q));
  }, [bookableProfiles, memberSearch]);

  const saveDraft = async () => {
    if (!subject.trim() && !bodyHtml.trim()) {
      toast.error("Add a subject or body before saving");
      return;
    }
    setSavingDraft(true);
    const user = await getUser();
    const payload = {
      subject: subject.trim() || "(no subject)",
      body_html: bodyHtml,
      recipient_filter: {
        type: recipientType,
        role: roleValue,
        individual_profile_id: individualProfileId || null,
        specific_profile_ids: specificProfileIds,
      },
      status: "draft" as const,
      created_by: user?.id ?? null,
    };
    if (draftId) {
      const { error } = await supabase.from("email_campaigns").update(payload).eq("id", draftId);
      setSavingDraft(false);
      if (error) {
        toast.error(supabaseErrorMessage(error, "Could not save campaign"));
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("email_campaigns")
        .insert(payload)
        .select("id")
        .maybeSingle();
      setSavingDraft(false);
      if (error) {
        toast.error(supabaseErrorMessage(error, "Could not save campaign"));
        return;
      }
      setDraftId((data as { id?: string } | null)?.id ?? null);
    }
    toast.success("Draft saved");
    await load();
  };

  const send = async () => {
    setSending(true);
    setSendProgress(null);
    let recipients: string[] = [];
    try {
      recipients = await queryRecipients();
    } catch (e: unknown) {
      setSending(false);
      setSendProgress(null);
      console.error("email recipients load failed", e);
      toast.error(supabaseErrorMessage(e, "Could not load recipients"));
      return;
    }
    if (recipients.length === 0) {
      setSending(false);
      setSendProgress(null);
      toast.error("No recipients matched this filter");
      return;
    }

    setSendProgress({ done: 0, total: recipients.length, failed: 0 });

    let success = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i++) {
      const email = recipients[i]!;
      const ok = await invokeMarketingEmail(email);
      if (ok) success += 1;
      else failed += 1;
      setSendProgress({ done: i + 1, total: recipients.length, failed });
    }

    const user = await getUser();
    const payload = {
      subject: subject.trim() || "(no subject)",
      body_html: bodyHtml,
      recipient_filter: {
        type: recipientType,
        role: roleValue,
        individual_profile_id: individualProfileId || null,
        specific_profile_ids: specificProfileIds,
      },
      sent_at: new Date().toISOString(),
      sent_count: success,
      status: "sent" as const,
      created_by: user?.id ?? null,
    };
    const { error: campaignErr } = draftId
      ? await supabase.from("email_campaigns").update(payload).eq("id", draftId)
      : await supabase.from("email_campaigns").insert(payload);
    if (campaignErr) {
      console.error("email_campaigns save after send", campaignErr);
      toast.error(
        supabaseErrorMessage(
          campaignErr,
          `Sent ${success} email(s) but could not save campaign record`,
        ),
      );
    }

    setSending(false);
    setSendProgress(null);
    setConfirmSendOpen(false);
    if (failed === 0) toast.success(`Sent ${success} email${success === 1 ? "" : "s"}`);
    else toast.warning(`${success} sent, ${failed} failed`);
    setSubject("");
    setBodyHtml("");
    setDraftId(null);
    if (editorRef.current) editorRef.current.innerHTML = "";
    await load();
    setTab("campaigns");
  };

  const recipientLabel = useMemo(() => {
    switch (recipientType) {
      case "all":
        return "All members";
      case "active":
        return "Active only (booked in last 30 days)";
      case "lapsed":
        return "Lapsed only (no booking in 30 days)";
      case "role":
        if (roleValue === "customer" && individualProfileId) {
          const p = bookableProfiles.find((x) => x.id === individualProfileId);
          return p ? `Customer: ${profileLabel(p)}` : "One customer";
        }
        return `By role: ${roleValue}`;
      case "specific":
        return `Specific members (${specificProfileIds.length} selected)`;
      case "legacy_import":
        return "Imported members (not signed up yet)";
    }
  }, [
    recipientType,
    roleValue,
    individualProfileId,
    specificProfileIds.length,
    bookableProfiles,
  ]);

  const openCampaign = (c: CampaignRow) => setDetail(c);

  return (
    <div>
      <PageHeader
        title="Email Marketing"
        description={loading ? "Loading…" : `${campaigns.length} campaigns`}
        actions={
          <Button
            type="button"
            onClick={newCampaign}
            className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
          >
            <Mail className="h-4 w-4" /> New campaign
          </Button>
        }
      />

      <div className="mb-4 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground tabular-nums">
            {customerProfileCount == null ? "—" : customerProfileCount.toLocaleString()}
          </span>{" "}
          registered customer profiles.{" "}
          {legacyAudience && legacyAudience.unclaimed > 0 ? (
            <>
              Plus{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {legacyAudience.unclaimed.toLocaleString()}
              </span>{" "}
              imported Mindbody members waiting to sign up (
              {legacyAudience.claimed.toLocaleString()} already re-registered). Campaign{" "}
              <span className="font-medium text-foreground">All members</span> and{" "}
              <span className="font-medium text-foreground">Imported members (not signed up yet)</span>{" "}
              include those staging emails.
            </>
          ) : (
            <>Use campaign filters below to choose who receives each send.</>
          )}{" "}
          <Link
            to="/admin/customers"
            className="font-semibold text-[#a3b693] underline-offset-2 hover:underline"
          >
            Customers
          </Link>{" "}
          lists registered profiles only; legacy import progress appears there.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="compose">New campaign</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="mt-0">
          <div className="min-w-0 overflow-x-auto rounded-2xl border border-border bg-card">
            {loading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Mail className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">No campaigns yet.</p>
              </div>
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Subject</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Sent count</th>
                    <th className="px-5 py-3 font-medium">Sent at</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c) => (
                    <tr
                      key={c.id}
                      role="link"
                      tabIndex={0}
                      onClick={() => openCampaign(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openCampaign(c);
                        }
                      }}
                      className="cursor-pointer border-t border-border hover:bg-muted/30"
                    >
                      <td className="max-w-[260px] truncate px-5 py-3 font-semibold">
                        {c.subject}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            c.status === "sent"
                              ? "bg-green-100 text-green-800"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 tabular-nums text-muted-foreground">
                        {c.sent_count}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                        {formatDate(c.sent_at)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                        {formatDate(c.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!loading && campaigns.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                Page {page} of {pageCount} · {campaigns.length} total
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="compose" className="mt-0">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="grid gap-1.5">
                <Label htmlFor="ec-subject">Subject</Label>
                <Input
                  id="ec-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div className="mt-3 grid gap-1.5">
                <Label>Body</Label>
                <div className="rounded-lg border border-border bg-background">
                  <div className="flex items-center gap-1 border-b border-border px-2 py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => exec("bold")}
                      aria-label="Bold"
                    >
                      <Bold className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => exec("italic")}
                      aria-label="Italic"
                    >
                      <Italic className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={insertLink}
                      aria-label="Insert link"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={uploadingImage}
                      aria-label="Insert image"
                    >
                      {uploadingImage ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void insertImageFromFile(file);
                      }}
                    />
                  </div>
                  <div
                    ref={editorRef}
                    contentEditable
                    role="textbox"
                    aria-multiline="true"
                    className="min-h-[220px] px-3 py-3 text-sm outline-none [&_img]:my-3 [&_img]:block [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg"
                    onInput={syncEditorHtml}
                    onPaste={handleEditorPaste}
                    suppressContentEditableWarning
                  />
                </div>
              </div>

              <div className="mt-3 grid gap-1.5">
                <Label>Templates</Label>
                <div className="flex flex-wrap gap-2">
                  {EMAIL_CAMPAIGN_TEMPLATES.map((tpl) => (
                    <Button
                      key={tpl.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => applyTemplate(tpl.id)}
                    >
                      {tpl.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid gap-1.5">
                <Label>Recipients</Label>
                <Select
                  value={recipientType}
                  onValueChange={(v) => {
                    setRecipientType(v as RecipientFilter);
                    if (v !== "specific") setSpecificProfileIds([]);
                    if (v !== "role") setIndividualProfileId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All members</SelectItem>
                    <SelectItem value="legacy_import">
                      Imported members (not signed up yet)
                    </SelectItem>
                    <SelectItem value="specific">Specific members</SelectItem>
                    <SelectItem value="role">By role</SelectItem>
                    <SelectItem value="active">Active only</SelectItem>
                    <SelectItem value="lapsed">Lapsed only</SelectItem>
                  </SelectContent>
                </Select>
                {recipientType === "role" && (
                  <div className="mt-2 space-y-2">
                    <Select value={roleValue} onValueChange={setRoleValue}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="guide">Guide</SelectItem>
                        <SelectItem value="management">Management</SelectItem>
                        <SelectItem value="director">Director</SelectItem>
                        <SelectItem value="front_desk">Front desk</SelectItem>
                        <SelectItem value="team">Team</SelectItem>
                      </SelectContent>
                    </Select>
                    {roleValue === "customer" ? (
                      <Select
                        value={individualProfileId || "__all__"}
                        onValueChange={(v) =>
                          setIndividualProfileId(v === "__all__" ? "" : v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a customer" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All customers</SelectItem>
                          {bookableProfiles.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {profileLabel(p)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                )}
                {recipientType === "specific" && (
                  <div className="mt-2 space-y-2 rounded-lg border border-border p-3">
                    <Input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search members…"
                    />
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {filteredProfiles.map((p) => {
                        const checked = specificProfileIds.includes(p.id);
                        return (
                          <label
                            key={p.id}
                            className="flex cursor-pointer items-start gap-2 text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(next) => {
                                setSpecificProfileIds((prev) =>
                                  next === true
                                    ? [...prev, p.id]
                                    : prev.filter((id) => id !== p.id),
                                );
                              }}
                            />
                            <span className="min-w-0 break-all">{profileLabel(p)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
                {recipientCount != null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {recipientCount} recipient{recipientCount === 1 ? "" : "s"} matched.
                  </p>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => setPreviewOpen(true)}
                  disabled={!subject.trim() && !bodyHtml.trim()}
                >
                  <Eye className="h-4 w-4" /> Preview
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => void saveDraft()}
                  disabled={savingDraft}
                >
                  {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save draft
                </Button>
                <Button
                  type="button"
                  className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
                  onClick={() => setConfirmSendOpen(true)}
                  disabled={sending || !subject.trim()}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send campaign
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-display text-lg font-semibold">Preview</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Recipients: {recipientLabel}
              </p>
              <div className="mt-4 overflow-hidden rounded-xl border border-border">
                <iframe
                  title="Email preview"
                  className="h-[480px] w-full bg-white"
                  srcDoc={previewWrap(subject, bodyHtml)}
                />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.subject ?? "Campaign"}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Status: {detail.status}</span>
                <span>Sent: {detail.sent_count}</span>
                <span>Sent at: {formatDate(detail.sent_at)}</span>
                <span>Created: {formatDate(detail.created_at)}</span>
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                <iframe
                  title="Campaign preview"
                  className="h-[420px] w-full bg-white"
                  srcDoc={previewWrap(detail.subject, detail.body_html)}
                />
              </div>
              {detail.status === "sent" && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    setSubject(detail.subject);
                    setBodyHtml(detail.body_html);
                    if (editorRef.current) editorRef.current.innerHTML = detail.body_html;
                    setDraftId(null);
                    const filter = (detail.recipient_filter ?? {}) as Record<string, unknown>;
                    setRecipientType((filter.type as RecipientFilter) ?? "all");
                    if (filter.role) setRoleValue(String(filter.role));
                    setIndividualProfileId(
                      filter.individual_profile_id ? String(filter.individual_profile_id) : "",
                    );
                    setSpecificProfileIds(
                      Array.isArray(filter.specific_profile_ids)
                        ? (filter.specific_profile_ids as string[])
                        : [],
                    );
                    setDetail(null);
                    setTab("compose");
                  }}
                >
                  <Send className="h-4 w-4" /> Resend
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview — {subject || "(no subject)"}</DialogTitle>
          </DialogHeader>
          <div className="overflow-hidden rounded-xl border border-border">
            <iframe
              title="Preview"
              className="h-[520px] w-full bg-white"
              srcDoc={previewWrap(subject, bodyHtml)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmSendOpen} onOpenChange={setConfirmSendOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this campaign?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will send to {recipientCount ?? "?"} recipient
                  {recipientCount === 1 ? "" : "s"} ({recipientLabel}). Each message goes through
                  the send-email edge function (Resend). This cannot be undone.
                </p>
                {sending && sendProgress ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      Sending {sendProgress.done} of {sendProgress.total}
                      {sendProgress.failed > 0
                        ? ` · ${sendProgress.failed} failed`
                        : ""}
                      …
                    </p>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-[#a3b693] transition-all duration-200"
                        style={{
                          width: `${Math.round((sendProgress.done / sendProgress.total) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void send();
              }}
              disabled={sending}
              className="bg-[#a3b693] text-white hover:bg-[#8fa67d]"
            >
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {sending && sendProgress
                ? `Sending (${sendProgress.done}/${sendProgress.total})`
                : "Send now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
