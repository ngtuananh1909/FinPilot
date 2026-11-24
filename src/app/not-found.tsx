import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md p-4">
      <EmptyState
        title="Không tìm thấy trang"
        description="Trang bạn tìm không tồn tại hoặc đã được di chuyển."
        action={
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-5 text-sm font-medium text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Về trang chủ
          </Link>
        }
      />
    </main>
  );
}
