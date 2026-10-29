import { createFileRoute } from "@tanstack/react-router";
import { MembershipPerksPanel } from "@/components/admin/MembershipPerksPanel";
import { AccessGroupsPanel } from "@/components/admin/PricingSetupPanels";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { getUser, supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Settings — One Flow Admin" }] }),
  component: SettingsPage,
});

const SETTING_KEYS = [
  "studio_name",
  "studio_phone",
  "studio_email",
  "late_cancel_fee_zar",
  "no_show_fee_zar",
  "late_cancel_window_minutes",
  "credit_loss_window_minutes",
  "late_fee_pay_hours",
  "booking_open_days_ahead",
  "checkin_open_minutes_before",
  "flow_points_per_class",
  "flow_points_conversion_rate",
] as const;

type SettingKey = (typeof SETTING_KEYS)[number];

const DEFAULT_VALUES: Record<SettingKey, string> = {
  studio_name: "One Flow",
  studio_phone: "+27 82 553 3033",
  studio_email: "info@oneflow.co.za",
  late_cancel_fee_zar: "100",
  no_show_fee_zar: "200",
  late_cancel_window_minutes: "120",
  credit_loss_window_minutes: "60",
  late_fee_pay_hours: "24",
  booking_open_days_ahead: "30",
  checkin_open_minutes_before: "120",
  flow_points_per_class: "10",
  flow_points_conversion_rate: "10",
};

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SettingsPage() {
  const [values, setValues] = useState<Record<SettingKey, string>>(DEFAULT_VALUES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearChecking, setClearChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("studio_settings").select("key, value");
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not load settings"));
      setLoading(false);
      return;
    }
    const next = { ...DEFAULT_VALUES };
    for (const row of (data ?? []) as { key: string; value: string | null }[]) {
      if ((SETTING_KEYS as readonly string[]).includes(row.key)) {
        next[row.key as SettingKey] = row.value ?? "";
      }
    }
    setValues(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (key: SettingKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const saveAll = async () => {
    setSaving(true);
    const user = await getUser();
    const updatedBy = user?.id ?? null;
    const upserts = SETTING_KEYS.map((key) => ({
      key,
      value: values[key],
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("studio_settings").upsert(upserts, { onConflict: "key" });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(supabaseErrorMessage(error, "Could not save settings"));
      return;
    }
    toast.success("Settings saved");
  };

  const exportData = async () => {
    setExporting(true);
    const [profilesRes, bookingsRes] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name, email, phone, role, created_at"),
      supabase
        .from("bookings")
        .select(
          "id, profile_id, class_id, status, payment_method, checked_in, checked_in_at, created_at",
        ),
    ]);
    setExporting(false);

    if (profilesRes.error) {
      toast.error(supabaseErrorMessage(profilesRes.error, "Could not export profiles"));
      return;
    }
    if (bookingsRes.error) {
      toast.error(supabaseErrorMessage(bookingsRes.error, "Could not export bookings"));
      return;
    }

    const stamp = new Date().toISOString().slice(0, 10);

    const profileHeader = ["id", "first_name", "last_name", "email", "phone", "role", "created_at"];
    const profileBody = (profilesRes.data ?? []).map((p: Record<string, unknown>) => [
      String(p.id ?? ""),
      String(p.first_name ?? ""),
      String(p.last_name ?? ""),
      String(p.email ?? ""),
      String(p.phone ?? ""),
      String(p.role ?? ""),
      String(p.created_at ?? ""),
    ]);
    downloadCsv(`profiles-${stamp}.csv`, [profileHeader, ...profileBody]);

    const bookingHeader = [
      "id",
      "profile_id",
      "class_id",
      "status",
      "payment_method",
      "checked_in",
      "checked_in_at",
      "created_at",
    ];
    const bookingBody = (bookingsRes.data ?? []).map((b: Record<string, unknown>) => [
      String(b.id ?? ""),
      String(b.profile_id ?? ""),
      String(b.class_id ?? ""),
      String(b.status ?? ""),
      String(b.payment_method ?? ""),
      String(b.checked_in ?? ""),
      String(b.checked_in_at ?? ""),
      String(b.created_at ?? ""),
    ]);
    downloadCsv(`bookings-${stamp}.csv`, [bookingHeader, ...bookingBody]);

    toast.success("Data exported");
  };

  const startClearTestData = async () => {
    setClearChecking(true);
    const { count, error } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true });
    setClearChecking(false);
    if (error) {
      toast.error(supabaseErrorMessage(error, "Could not check booking count"));
      return;
    }
    if ((count ?? 0) >= 10) {
      toast.error("Refusing to clear test data — more than 10 bookings exist.");
      return;
    }
    setClearOpen(true);
  };

  const confirmClearTestData = async () => {
    setClearOpen(false);
    const { error: bErr } = await supabase
      .from("bookings")
      .delete()
      .gte("created_at", "1970-01-01");
    if (bErr) {
      toast.error(supabaseErrorMessage(bErr, "Could not clear bookings"));
      return;
    }
    toast.success("Test bookings cleared");
  };

  const fields = useMemo(
    () => [
      {
        section: "General",
        items: [
          { key: "studio_name" as SettingKey, label: "Studio name", type: "text" },
          { key: "studio_phone" as SettingKey, label: "Phone", type: "tel" },
          { key: "studio_email" as SettingKey, label: "Email", type: "email" },
        ],
      },
      {
        section: "Booking rules",
        items: [
          {
            key: "late_cancel_fee_zar" as SettingKey,
            label: "Late cancellation fee (ZAR)",
            type: "number",
          },
          {
            key: "late_cancel_window_minutes" as SettingKey,
            label: "Late cancellation starts (mins before class)",
            type: "number",
          },
          {
            key: "credit_loss_window_minutes" as SettingKey,
            label: "Class packs: credit is used if cancelled within (mins before class)",
            type: "number",
          },
          {
            key: "late_fee_pay_hours" as SettingKey,
            label: "Class packs: hours to pay the late fee and keep the credit",
            type: "number",
          },
          {
            key: "no_show_fee_zar" as SettingKey,
            label: "Memberships: no-show fee (ZAR)",
            type: "number",
          },
          {
            key: "booking_open_days_ahead" as SettingKey,
            label: "Days ahead bookings open",
            type: "number",
          },
          {
            key: "checkin_open_minutes_before" as SettingKey,
            label: "Check-in opens (mins before class)",
            type: "number",
          },
        ],
      },
      {
        section: "Flow Points",
        items: [
          {
            key: "flow_points_per_class" as SettingKey,
            label: "Points earned per class attended",
            type: "number",
          },
          {
            key: "flow_points_conversion_rate" as SettingKey,
            label: "Rand discount per 100 points at checkout (e.g. 10 = R10 off per 100 pts)",
            type: "number",
          },
        ],
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Studio-wide settings used across the app."
        actions={
          <Button
            type="button"
            onClick={() => void saveAll()}
            disabled={loading || saving}
            className="gap-2 bg-[#a3b693] text-white hover:bg-[#8fa67d]"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        }
      />

      <div className="space-y-6">
        {fields.map((group) => (
          <section key={group.section} className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 font-display text-lg font-semibold">{group.section}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {group.items.map((item) => (
                <div key={item.key} className="grid gap-1.5">
                  <Label htmlFor={`set-${item.key}`}>{item.label}</Label>
                  <Input
                    id={`set-${item.key}`}
                    type={item.type}
                    value={values[item.key]}
                    onChange={(e) => update(item.key, e.target.value)}
                    disabled={loading}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}

        <AccessGroupsPanel />

        <MembershipPerksPanel />

        <section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h3 className="font-display text-lg font-semibold text-destructive">Danger zone</h3>
          </div>
          <p className="mt-1 text-xs text-destructive/80">Destructive actions. Use with care.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => void exportData()}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export all data (CSV)
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => void startClearTestData()}
              disabled={clearChecking}
            >
              {clearChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Clear test data
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Clear test data only works while there are fewer than 10 bookings on the system.
          </p>
        </section>
      </div>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all test bookings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete every booking row. Profiles and products are kept. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmClearTestData()}
            >
              Yes, delete bookings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
