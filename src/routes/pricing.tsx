import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Switch } from "@/components/ui/switch";
import { getUser, supabase } from "@/lib/supabase";
import { supabaseErrorMessage } from "@/lib/supabaseErrors";
import {
  maxPackFlowPointsRedemption,
  parseFlowPointsConversionRate,
} from "@/lib/flowPointsRedemption";
import { STUDIO_WHATSAPP_URL } from "@/lib/studioContact";
import { cn } from "@/lib/utils";

/** Categories shown on customer pricing (excludes `staff` and `cafe` — admin only). */
const CUSTOMER_PRICING_CATEGORY_ORDER = [
  "yoga",
  "wellzone",
  "all_access",
  "power",
] as const;

type CustomerPricingCategory = (typeof CUSTOMER_PRICING_CATEGORY_ORDER)[number];

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Buy A Pass — One Flow" },
      { name: "description", content: "Class packs and passes for One Flow." },
    ],
  }),
  validateSearch: (raw: Record<string, unknown>) => {
    const category = typeof raw.category === "string" ? raw.category.trim().toLowerCase() : "";
    const allowed = new Set(["yoga", "wellzone", "all_access", "power"]);
    return {
      category: allowed.has(category) ? (category as CustomerPricingCategory) : undefined,
    };
  },
  component: PricingPage,
});

const SECTION_TITLES: Record<CustomerPricingCategory, string> = {
  yoga: "Class Packs (Yoga, Sculpt & Pilates)",
  wellzone: "Wellzone & Sauna",
  all_access: "All Access Memberships",
  power: "Power Memberships",
};

const ACCORDION_SECTIONS: { category: CustomerPricingCategory; title: string }[] =
  CUSTOMER_PRICING_CATEGORY_ORDER.map((category) => ({
    category,
    title: SECTION_TITLES[category],
  }));

type ProductRow = {
  id: string;
  name: string;
  price_zar: number;
  credit_count: number | null;
  description: string | null;
  is_active?: boolean | null;
  is_staff_only?: boolean | null;
  sort_order?: number | null;
  category: string | null;
  allowed_class_types: string[] | null;
  validity_days?: number | null;
};

function formatPriceZar(zar: number) {
  const n = Number(zar);
  if (Number.isNaN(n)) return "R—";
  return `R${n.toLocaleString("en-ZA", { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;
}

/** Credits line for display; omit row when null (unknown count). */
function creditsLine(p: ProductRow): string | null {
  const raw = p.credit_count;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  if (n >= 999) return "Unlimited";
  if (n === 1) return "1 class";
  return `${Math.trunc(n)} classes`;
}

function dedupeProductsById(rows: ProductRow[]): ProductRow[] {
  const byId = new Map<string, ProductRow>();
  for (const row of rows) {
    if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function isCustomerPricingCategory(cat: string | null | undefined): cat is CustomerPricingCategory {
  const c = String(cat ?? "").toLowerCase();
  return (CUSTOMER_PRICING_CATEGORY_ORDER as readonly string[]).includes(c);
}

const EXCLUDED_PRICING_CATEGORIES = new Set(["staff", "cafe", "complimentary"]);

/** Belt-and-suspenders client filter matching the products query. */
function filterCustomerPricingProducts(rows: ProductRow[]): ProductRow[] {
  return rows.filter((p) => {
    if (p.is_staff_only === true) return false;
    if (Number(p.price_zar ?? 0) <= 0) return false;
    const cat = String(p.category ?? "").toLowerCase();
    if (EXCLUDED_PRICING_CATEGORIES.has(cat)) return false;
    return isCustomerPricingCategory(cat);
  });
}

function PricingPage() {
  const router = useRouter();
  const search = Route.useSearch();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [checkoutSlow, setCheckoutSlow] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState<
    | { kind: "idle" }
    | { kind: "valid"; label: string }
    | { kind: "invalid"; message: string }
  >({ kind: "idle" });
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [flowPointsState, setFlowPointsState] = useState<"loading" | "guest" | number>("loading");
  const [conversionRate, setConversionRate] = useState(10);
  const [useFlowPointsFor, setUseFlowPointsFor] = useState<Record<string, boolean>>({});

  const itemsByCategory = useMemo(() => {
    const buckets: Record<CustomerPricingCategory, ProductRow[]> = {
      yoga: [],
      wellzone: [],
      all_access: [],
      power: [],
    };

    for (const p of products) {
      const cat = String(p.category ?? "").toLowerCase();
      if (!isCustomerPricingCategory(cat)) continue;
      buckets[cat].push(p);
    }

    const byPriceAsc = (a: ProductRow, b: ProductRow) => {
      const priceDiff = (Number(a.price_zar) || 0) - (Number(b.price_zar) || 0);
      if (priceDiff !== 0) return priceDiff;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    };

    for (const c of CUSTOMER_PRICING_CATEGORY_ORDER) {
      buckets[c].sort(byPriceAsc);
    }

    return buckets;
  }, [products]);

  const sectionsToRender = useMemo(
    () =>
      ACCORDION_SECTIONS.filter(
        ({ category }) => (itemsByCategory[category] ?? []).length > 0,
      ),
    [itemsByCategory],
  );

  useEffect(() => {
    if (!search.category) return;
    setOpenSections((prev) => ({ ...prev, [search.category!]: true }));
  }, [search.category]);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      setLoading(true);
      const paidRes = await supabase
        .from("products")
        .select(
          "id, name, price_zar, credit_count, description, is_active, is_staff_only, sort_order, category, allowed_class_types, validity_days",
        )
        .eq("is_active", true)
        .eq("is_addon", false)
        .eq("is_staff_only", false)
        .eq("is_class_ticket", false)
        .gt("price_zar", 0)
        .not("category", "in", "(staff,cafe,complimentary)")
        .order("category", { ascending: true })
        .order("price_zar", { ascending: true });

      if (cancelled) return;

      if (paidRes.error) {
        console.error(paidRes.error);
        toast.error(supabaseErrorMessage(paidRes.error, "Could not load products"));
        setProducts([]);
        setLoading(false);
        return;
      }

      const rows = filterCustomerPricingProducts(
        dedupeProductsById((paidRes.data ?? []) as ProductRow[]),
      );
      setProducts(rows);
      setLoading(false);
    }

    void fetchOnce();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getUser();
      if (cancelled) return;
      if (!user) {
        setFlowPointsState("guest");
        return;
      }
      const [{ data: prof }, { data: rateRow }] = await Promise.all([
        supabase.from("profiles").select("flow_points").eq("id", user.id).maybeSingle(),
        supabase
          .from("studio_settings")
          .select("value")
          .eq("key", "flow_points_conversion_rate")
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const fp = (prof as { flow_points?: number | null } | null)?.flow_points;
      setFlowPointsState(typeof fp === "number" && Number.isFinite(fp) ? Math.max(0, fp) : 0);
      setConversionRate(parseFlowPointsConversionRate(rateRow?.value as string | null | undefined));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!buyingId) {
      setCheckoutSlow(false);
      return;
    }
    setCheckoutSlow(false);
    const t = window.setTimeout(() => setCheckoutSlow(true), 5000);
    return () => window.clearTimeout(t);
  }, [buyingId]);

  const toggleSection = (category: string) => {
    setOpenSections((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  const buyNow = async (packId: string) => {
    if (buyingId) return;
    const user = await getUser();
    if (!user) {
      toast.error("Please sign in to purchase");
      window.location.assign("/auth");
      return;
    }

    const product = products.find((x) => x.id === packId);
    if (!product) {
      toast.error("Product not found");
      return;
    }

    const price = Number(product.price_zar ?? 0);
    if (price === 0) {
      setBuyingId(packId);
      const { error } = await supabase.rpc("claim_free_product", {
        p_product_id: product.id,
      });
      setBuyingId(null);
      if (error) {
        console.error("[pricing] free product claim failed", error);
        toast.error(supabaseErrorMessage(error, "Could not claim free class"));
        return;
      }
      toast.success(`${product.name} added to your account — book from Schedule`);
      return;
    }

    const usePts =
      typeof flowPointsState === "number" &&
      flowPointsState > 0 &&
      (useFlowPointsFor[packId] ?? false) &&
      product;
    const redemption = usePts
      ? maxPackFlowPointsRedemption(
          flowPointsState,
          Number(product.price_zar) || 0,
          conversionRate,
        )
      : { flow_points_used: 0, flow_points_discount_zar: 0 };

    setBuyingId(packId);
    setCheckoutSlow(false);
    const origin = window.location.origin;
    const successQs = new URLSearchParams({
      pack_id: packId,
      profile_id: user.id,
      flow_points_used: String(redemption.flow_points_used),
      flow_points_discount_zar: String(redemption.flow_points_discount_zar),
    });
    const body: Record<string, unknown> = {
      pack_id: packId,
      profile_id: user.id,
      success_url: `${origin}/payment/success?${successQs.toString()}`,
      cancel_url: `${origin}/pricing`,
      promo_code: promoCode || undefined,
    };
    if (redemption.flow_points_used > 0) {
      body.flow_points_used = redemption.flow_points_used;
      body.flow_points_discount_zar = redemption.flow_points_discount_zar;
    }

    const { data, error } = await supabase.functions.invoke("yoco-checkout", {
      body,
    });
    setBuyingId(null);

    if (error) {
      toast.error(error.message ?? "Checkout failed");
      setBuyingId(null);
      setCheckoutSlow(false);
      return;
    }

    const redirect =
      (data as { redirectUrl?: string; redirect_url?: string } | null)?.redirectUrl ??
      (data as { redirect_url?: string })?.redirect_url;
    if (!redirect || typeof redirect !== "string") {
      toast.error("No payment link returned");
      setBuyingId(null);
      setCheckoutSlow(false);
      return;
    }
    window.location.href = redirect;
  };

  return (
    <AppShell>
      <div className="flex flex-1 flex-col bg-gradient-to-b from-[#f4f7f0] to-background dark:from-background dark:to-background">
        <header className="safe-top flex shrink-0 items-center gap-3 px-5 pt-4 pb-2">
          <button
            type="button"
            onClick={() => router.history.back()}
            aria-label="Back"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#c5d4b8]/80 bg-card shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </header>

        <main className="flex-1 space-y-4 px-5 pb-8 pt-0 touch-pan-y">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#a3b693] dark:text-foreground">
            Buy A Pass
          </h1>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2
                className="h-8 w-8 animate-spin text-[#a3b693]"
                aria-label="Loading products"
              />
            </div>
          ) : sectionsToRender.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No packs available yet.
            </p>
          ) : (
            <div className="space-y-3">
              {sectionsToRender.map(({ category, title }) => {
                const open = openSections[category] ?? false;
                const items = itemsByCategory[category];
                const panelId = `pricing-panel-${category}`;
                const headerId = `pricing-header-${category}`;

                return (
                  <div
                    key={category}
                    className="rounded-2xl border border-[#c5d4b8]/70 bg-card shadow-sm dark:border-border"
                  >
                    <button
                      type="button"
                      id={headerId}
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => toggleSection(category)}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-[#e8efe3]/60 active:bg-[#e8efe3]/80 dark:hover:bg-muted/40"
                    >
                      <span className="min-w-0 flex-1 font-display text-sm font-bold leading-snug text-[#a3b693] dark:text-foreground sm:text-base">
                        {title}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-5 w-5 shrink-0 text-[#a3b693] transition-transform duration-200 dark:text-primary",
                          open && "rotate-180",
                        )}
                        aria-hidden
                      />
                    </button>
                    {open ? (
                      <div
                        id={panelId}
                        role="region"
                        aria-labelledby={headerId}
                        className="border-t border-[#c5d4b8]/50 bg-[#fafbf8]/80 px-3 py-4 dark:border-border dark:bg-card/50"
                      >
                        <ul className="flex flex-col gap-3">
                          {items.map((p) => {
                              const credits = creditsLine(p);
                              const priceN = Number(p.price_zar) || 0;
                              const pointsForFull =
                                priceN > 0 ? Math.ceil((priceN * 100) / conversionRate) : 0;
                              const usePts =
                                typeof flowPointsState === "number" &&
                                flowPointsState > 0 &&
                                (useFlowPointsFor[p.id] ?? false);
                              const redemption = usePts
                                ? maxPackFlowPointsRedemption(
                                    flowPointsState,
                                    priceN,
                                    conversionRate,
                                  )
                                : { flow_points_used: 0, flow_points_discount_zar: 0 };
                              return (
                                <li
                                  key={p.id}
                                  className={cn(
                                    "rounded-xl border border-[#c5d4b8]/60 bg-card p-4 shadow-sm",
                                    "dark:border-border",
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <h3 className="min-w-0 flex-1 truncate font-display text-base font-semibold leading-snug text-[#a3b693] dark:text-foreground">
                                      {p.name}
                                    </h3>
                                    <p className="shrink-0 font-display text-base font-bold tabular-nums text-[#a3b693] dark:text-foreground">
                                      {formatPriceZar(p.price_zar)}
                                    </p>
                                  </div>
                                  {credits ? (
                                    <p className="mt-1 text-sm font-medium text-[#a3b693] dark:text-primary">
                                      {credits}
                                    </p>
                                  ) : null}
                                  {pointsForFull > 0 ? (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      ≈{" "}
                                      <span className="font-semibold tabular-nums text-foreground">
                                        {pointsForFull.toLocaleString()}
                                      </span>{" "}
                                      Flow Points covers this pack at the current rate (100 pts = R
                                      {conversionRate}).
                                    </p>
                                  ) : null}
                                  {p.description ? (
                                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                      {p.description}
                                    </p>
                                  ) : null}
                                  {typeof flowPointsState === "number" && flowPointsState > 0 ? (
                                    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[#c5d4b8]/50 bg-[#fafbf8]/90 px-3 py-2.5 dark:border-border dark:bg-muted/30">
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-sm font-medium text-foreground">
                                          Use Flow Points
                                        </span>
                                        <Switch
                                          checked={useFlowPointsFor[p.id] ?? false}
                                          onCheckedChange={(v) =>
                                            setUseFlowPointsFor((prev) => ({ ...prev, [p.id]: v }))
                                          }
                                          aria-label={`Use Flow Points for ${p.name}`}
                                        />
                                      </div>
                                      {usePts && redemption.flow_points_used > 0 ? (
                                        <p className="text-sm font-semibold text-[#3d4f36] dark:text-primary">
                                          R{redemption.flow_points_discount_zar.toFixed(2)} discount
                                          applied ({redemption.flow_points_used.toLocaleString()}{" "}
                                          points)
                                        </p>
                                      ) : usePts ? (
                                        <p className="text-xs text-muted-foreground">
                                          Not enough points for a discount on this price.
                                        </p>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  <div className="mt-4 space-y-2">
                                    <button
                                      type="button"
                                      disabled={buyingId !== null}
                                      onClick={() => void buyNow(p.id)}
                                      className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#a3b693] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60 dark:bg-primary dark:text-primary-foreground"
                                    >
                                      {buyingId === p.id ? (
                                        <>
                                          <Loader2
                                            className="h-4 w-4 animate-spin shrink-0"
                                            aria-hidden
                                          />
                                          <span>Redirecting…</span>
                                        </>
                                      ) : (
                                        "Buy Now"
                                      )}
                                    </button>
                                    {buyingId === p.id ? (
                                      <p className="text-center text-xs text-muted-foreground">
                                        Redirecting to secure payment…
                                        {checkoutSlow ? (
                                          <span className="mt-1 block font-medium text-foreground">
                                            Still loading — please wait.
                                          </span>
                                        ) : null}
                                      </p>
                                    ) : null}
                                  </div>
                                </li>
                              );
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {flowPointsState === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading Flow Points…</p>
          ) : flowPointsState === "guest" ? (
            <div className="rounded-2xl border border-[#c5d4b8]/70 bg-[#fafbf8] px-4 py-3 text-sm dark:border-border dark:bg-card/60">
              <span className="font-semibold text-[#3d4f36] dark:text-foreground">Flow Points</span>{" "}
              —{" "}
              <Link
                to="/auth"
                className="font-medium text-[#a3b693] underline-offset-2 hover:underline dark:text-primary"
              >
                Sign in
              </Link>{" "}
              to earn and redeem points on packs and memberships.
            </div>
          ) : (
            <div className="rounded-2xl border border-[#c5d4b8]/80 bg-gradient-to-r from-[#e8efe3] to-card px-4 py-3 shadow-sm dark:border-border dark:from-card dark:to-card">
              <p className="font-display text-lg font-bold tracking-tight text-[#3d4f36] dark:text-foreground">
                You have {flowPointsState.toLocaleString()} Flow Points
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                100 points = R{conversionRate} off at checkout (studio rate). Toggle “Use Flow Points”
                on a pack above to redeem.
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-[#c5d4b8]/70 bg-card p-3 shadow-sm dark:border-border">
            <label
              htmlFor="promo-input"
              className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#a3b693] dark:text-foreground"
            >
              Promo code
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="promo-input"
                value={promoInput}
                onChange={(e) => {
                  setPromoInput(e.target.value.toUpperCase());
                  setPromoStatus({ kind: "idle" });
                }}
                placeholder="Enter code"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm uppercase outline-none focus:border-[#a3b693]"
              />
              <button
                type="button"
                onClick={async () => {
                  const code = promoInput.trim().toUpperCase();
                  if (!code) {
                    setPromoCode("");
                    setPromoStatus({ kind: "idle" });
                    return;
                  }
                  const { data: promo } = await supabase
                    .from("promotions")
                    .select(
                      "code, discount_type, discount_value, applies_to, max_uses, uses_count, valid_from, valid_until, is_active",
                    )
                    .eq("code", code)
                    .maybeSingle();
                  const p = promo as
                    | {
                        code: string;
                        discount_type: string;
                        discount_value: number;
                        applies_to: string;
                        max_uses: number | null;
                        uses_count: number | null;
                        valid_from: string | null;
                        valid_until: string | null;
                        is_active: boolean;
                      }
                    | null;
                  if (!p || !p.is_active) {
                    setPromoCode("");
                    setPromoStatus({ kind: "invalid", message: "Code not found." });
                    return;
                  }
                  const now = Date.now();
                  if (p.valid_from && new Date(p.valid_from).getTime() > now) {
                    setPromoCode("");
                    setPromoStatus({ kind: "invalid", message: "Code not yet valid." });
                    return;
                  }
                  if (p.valid_until && new Date(p.valid_until).getTime() < now) {
                    setPromoCode("");
                    setPromoStatus({ kind: "invalid", message: "Code has expired." });
                    return;
                  }
                  if (p.max_uses != null && (p.uses_count ?? 0) >= p.max_uses) {
                    setPromoCode("");
                    setPromoStatus({
                      kind: "invalid",
                      message: "Code has reached its usage limit.",
                    });
                    return;
                  }
                  const label =
                    p.discount_type === "percentage"
                      ? `${p.discount_value}% off`
                      : `R${Number(p.discount_value).toLocaleString("en-ZA")} off`;
                  setPromoCode(code);
                  setPromoStatus({ kind: "valid", label });
                  toast.success(`Code applied — ${label}`);
                }}
                className="shrink-0 rounded-lg bg-[#a3b693] px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
              >
                Apply
              </button>
            </div>
            {promoStatus.kind === "valid" && (
              <p className="mt-1.5 text-xs font-medium text-[#a3b693] dark:text-primary">
                ✓ {promoStatus.label}
              </p>
            )}
            {promoStatus.kind === "invalid" && (
              <p className="mt-1.5 text-xs font-medium text-destructive">{promoStatus.message}</p>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Questions?{" "}
            <button
              type="button"
              onClick={() => window.open(STUDIO_WHATSAPP_URL, "_blank")}
              className="font-medium text-[#a3b693] underline-offset-2 hover:underline dark:text-primary"
            >
              Contact us on WhatsApp
            </button>
            .
          </p>
        </main>
      </div>
    </AppShell>
  );
}
