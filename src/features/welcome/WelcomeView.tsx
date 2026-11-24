import Link from "next/link";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS_RING } from "@/components/ui/classes";
import { PersonaChooser, type VisitorSession } from "./PersonaChooser";
import type { PersonaCardModel } from "./personas";

export function BrandMark() {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-primary text-on-primary">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5l-2 5-5 2 2-5z" />
        </svg>
      </span>
      <span className="font-display text-title-lg text-on-surface">FinPilot AI</span>
    </span>
  );
}

export function WelcomeView({ personas, session }: { personas: PersonaCardModel[]; session: VisitorSession }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-4 py-6 lg:max-w-5xl lg:px-8">
      <header className="flex items-center justify-between">
        <BrandMark />
        <span className="rounded-full bg-primary-container px-3 py-1 text-label-sm text-on-primary-container">MVP tiếng Việt</span>
      </header>

      <main id="main-content" className="flex flex-col gap-8">
        <section aria-labelledby="welcome-title" className="flex flex-col gap-4 lg:max-w-2xl">
          <h1 id="welcome-title" className="font-display text-display-lg-mobile text-on-surface lg:text-display-lg">
            Biết trước dòng tiền 45 ngày tới
          </h1>
          <p className="text-body-lg text-on-surface-variant">
            Ghi chép thu chi gọn nhẹ, hỏi trợ lý AI bằng tiếng Việt và thử mô phỏng mua sắm trước khi quyết định.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href="#demo-personas" className={BUTTON_PRIMARY}>
              Trải nghiệm demo
            </a>
            <Link href="/login" className={BUTTON_SECONDARY}>
              Đăng nhập
            </Link>
          </div>
          <p className="text-body-md text-on-surface-variant">
            Chưa có tài khoản?{" "}
            <Link href="/signup" className={`rounded-sm font-semibold text-primary underline underline-offset-2 ${FOCUS_RING}`}>
              Đăng ký bằng email
            </Link>{" "}
            (không bắt buộc).
          </p>
        </section>

        <PersonaChooser personas={personas} session={session} />

        <section aria-labelledby="notice-title" className="rounded-card border border-outline-variant bg-surface-container-low p-4">
          <h2 id="notice-title" className="text-title-md text-on-surface">
            Lưu ý trước khi dùng
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-on-surface-variant">
            <li>Dữ liệu trong hồ sơ demo là dữ liệu mẫu tổng hợp, không phải của người thật.</li>
            <li>FinPilot AI không phải ngân hàng, không kết nối tài khoản ngân hàng và không chuyển tiền.</li>
            <li>Mọi dự báo và mô phỏng chỉ là ước tính tham khảo, không phải lời khuyên tài chính.</li>
          </ul>
        </section>
      </main>

      <footer className="pt-2 text-center text-body-sm text-on-surface-variant">
        FinPilot AI · Trợ lý dòng tiền cá nhân minh bạch, không tự động chuyển khoản.
      </footer>
    </div>
  );
}
