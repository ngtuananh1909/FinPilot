import Link from "next/link";
import { BUTTON_PRIMARY } from "@/components/ui/classes";
import { EmptyState } from "@/components/ui/EmptyState";
import { RetryButton } from "@/components/ui/RetryButton";
import type { DateBounds } from "./form";
import { SimulatorForm } from "./SimulatorForm";

export type SimulatorState =
  | { kind: "ready"; bounds: DateBounds; reserveVnd: string }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string; code?: string | undefined };

const Heading = () => (
  <header>
    <h1 className="text-headline-md text-on-surface">Mô phỏng mua ngay hay mua sau</h1>
    <p className="mt-1 text-body-md text-on-surface-variant">
      So sánh số dư 45 ngày tới nếu bạn mua ngay hoặc đợi đến một ngày khác. Đây là ước tính, không phải lời khuyên tài chính.
    </p>
  </header>
);

export function SimulatorContent({ state }: { state: SimulatorState }) {
  if (state.kind === "error") {
    return (
      <div className="space-y-4">
        <Heading />
        <div role="alert" className="rounded-card border border-error/40 bg-surface-container-lowest p-6 text-center">
          <h2 className="text-title-lg text-error">Không tải được dữ liệu mô phỏng</h2>
          <p className="mt-2 text-body-md text-on-surface-variant">{state.message}</p>
          {state.code ? <p className="mt-1 text-body-sm text-outline">Mã lỗi: {state.code}</p> : null}
          <div className="mt-4 flex justify-center">
            <RetryButton />
          </div>
        </div>
      </div>
    );
  }
  if (state.kind === "empty") {
    return (
      <div className="space-y-4">
        <Heading />
        <EmptyState
          title="Chưa thể mô phỏng"
          description={state.message}
          action={
            <Link href="/onboarding" className={BUTTON_PRIMARY}>
              Hoàn thiện hồ sơ
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Heading />
      <SimulatorForm bounds={state.bounds} reserveVnd={state.reserveVnd} />
    </div>
  );
}
