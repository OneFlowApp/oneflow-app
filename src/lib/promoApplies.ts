/**
 * Which products a promo code works on. Mirrored in supabase/functions/yoco-checkout.
 *   all       every product
 *   yoga      products in the Yoga category (older codes)
 *   wellzone  products in the Wellzone category (older codes)
 *   custom    any chosen pricing section, class type or product
 */
export type PromoScope = {
  applies_to: string;
  applies_section_ids?: string[] | null;
  applies_class_types?: string[] | null;
  applies_product_ids?: string[] | null;
};

export type PromoProduct = {
  id: string;
  category?: string | null;
  pricing_section_id?: string | null;
  allowed_class_types?: string[] | null;
};

export function promoAppliesToProduct(promo: PromoScope, product: PromoProduct): boolean {
  const cat = String(product.category ?? "");
  if (promo.applies_to === "all") return true;
  if (promo.applies_to === "yoga") return cat === "yoga";
  if (promo.applies_to === "wellzone") return cat === "wellzone";
  if (promo.applies_to === "custom") {
    if ((promo.applies_product_ids ?? []).includes(product.id)) return true;
    if (
      product.pricing_section_id &&
      (promo.applies_section_ids ?? []).includes(product.pricing_section_id)
    )
      return true;
    const types = new Set((promo.applies_class_types ?? []).map(String));
    return (product.allowed_class_types ?? []).some((t) => types.has(String(t)));
  }
  return false;
}
