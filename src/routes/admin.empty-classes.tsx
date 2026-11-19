import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyClassesReview } from "@/components/admin/EmptyClassesReview";

export const Route = createFileRoute("/admin/empty-classes")({
  head: () => ({ meta: [{ title: "Empty classes — One Flow Admin" }] }),
  component: () => (
    <div className="pb-10">
      <PageHeader
        title="Empty classes"
        description="Director and Management: did the guide stay or leave when nobody was booked?"
      />
      <EmptyClassesReview />
    </div>
  ),
});
