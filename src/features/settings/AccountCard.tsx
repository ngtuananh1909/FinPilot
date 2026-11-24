"use client";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BUTTON_SECONDARY } from "@/components/ui/classes";
import { SignOutButton } from "@/components/shell/SignOutButton";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { browserFetch, type FetchLike } from "@/lib/http/api-call";
import type { ProfileDto } from "@/lib/settings/dto";
import { resetDemoApi } from "./api";
import { SettingsCard } from "./SettingsCard";
const PERSONA_NAME: Record<string, string> = {
  student: "Sinh viên",
  worker: "Người mới đi làm",
  at_risk: "Dòng tiền cần chú ý",
};
/** What kind of account this is, for the badge and the reset rule. */
export function accountKind(isGuest: boolean, isDemo: boolean): "guest" | "demo" | "real" {
  if (isGuest) return "guest";
  return isDemo ? "demo" : "real";
}
const KIND_BADGE = {
  guest: { tone: "primary", text: "Khách (Demo)" },
  demo: { tone: "primary", text: "Tài khoản Demo mẫu" },
  real: { tone: "neutral", text: "Tài khoản của bạn" },
} as const;
/**
 * Account section. "Đặt lại dữ liệu demo" is rendered only for guests and demo accounts: it replaces
 * the user's own data with the sample persona and is never offered for real accounts.
 */
export function AccountCard({
  profile,
  isGuest,
  onReset,
  fetchImpl = browserFetch,
}: {
  profile: ProfileDto;
  isGuest: boolean;
  onReset: (message: string) => void;
  fetchImpl?: FetchLike;
}) {
  const kind = accountKind(isGuest, profile.isDemo);
  const badge = KIND_BADGE[kind];
  const guard = useRef(createSubmitGuard()).current;
  const keyRef = useRef<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function open() {
    keyRef.current = crypto.randomUUID(); // one key per confirmation; a retry of the same dialog reuses it
    setError(null);
    setConfirmOpen(true);
  }
  async function reset() {
    if (!guard.tryEnter()) return;
    setPending(true);
    setError(null);
    const res = await resetDemoApi(fetchImpl, keyRef.current ?? crypto.randomUUID());
    setPending(false);
    guard.leave();
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setConfirmOpen(false);
    onReset("Đã đặt lại dữ liệu demo về hồ sơ mẫu ban đầu.");
  }
  const persona = profile.personaCode ? PERSONA_NAME[profile.personaCode] : null;
  return (
    <SettingsCard id="settings-account" title="Tài khoản và quyền riêng tư">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={badge.tone}>{badge.text}</Badge>
        {persona && kind !== "real" ? <span className="text-body-md text-on-surface-variant">Hồ sơ mẫu: {persona}</span> : null}
      </div>
      {kind !== "real" ? (
        <div className="mt-4 space-y-2">
          <p className="text-body-md text-on-surface-variant">
            Bạn đang dùng dữ liệu demo. Đặt lại sẽ xóa các thay đổi của riêng bạn và đưa dữ liệu về hồ sơ mẫu ban đầu.
            Chỉ ảnh hưởng dữ liệu của tài khoản này.
          </p>
          <button type="button" onClick={open} className={BUTTON_SECONDARY}>
            Đặt lại dữ liệu demo
          </button>
        </div>
      ) : null}
      <div className="mt-4 flex items-center gap-2">
        <SignOutButton isGuest={isGuest} />
        <span className="text-body-sm text-on-surface-variant">
          {isGuest ? "Đăng xuất khỏi phiên khách sẽ làm mất dữ liệu demo của phiên này." : "Đăng xuất khỏi thiết bị này."}
        </span>
      </div>
      <div className="mt-6 space-y-2 border-t border-outline-variant pt-4 text-body-md text-on-surface-variant">
        <h3 className="text-title-md text-on-surface">Quyền riêng tư</h3>
        <p>
          Dữ liệu demo là dữ liệu mẫu tổng hợp, không phải thông tin của người thật. FinPilot không kết nối ngân hàng,
          không thực hiện thanh toán, và các con số chỉ là ước tính, không phải lời khuyên tài chính.
        </p>
        <p>Dữ liệu bạn nhập chỉ hiển thị cho tài khoản của bạn.</p>
        <p>
          <strong>Yêu cầu xóa tài khoản và dữ liệu:</strong> sắp có. Hiện chưa có chức năng tự xóa tài khoản trong ứng
          dụng.
        </p>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Đặt lại dữ liệu demo?"
        description="Mọi giao dịch, khoản định kỳ, mục tiêu và chỉnh sửa của bạn sẽ trở về dữ liệu mẫu ban đầu. Hành động này không thể hoàn tác."
        confirmLabel="Xác nhận đặt lại"
        pendingLabel="Đang đặt lại…"
        cancelLabel="Hủy"
        pending={pending}
        error={error}
        onConfirm={() => void reset()}
        onCancel={() => setConfirmOpen(false)}
      />
    </SettingsCard>
  );
}
