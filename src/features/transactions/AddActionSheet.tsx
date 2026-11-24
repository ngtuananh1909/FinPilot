"use client";
import { Dialog } from "@/components/ui/Dialog";
import { BUTTON_SECONDARY, FOCUS_RING } from "@/components/ui/classes";
export type AddAction = "manual" | "csv" | "receipt";
const OPTION =
  `flex min-h-[56px] w-full flex-col justify-center rounded-control border border-outline-variant bg-surface-container-lowest px-4 py-2 text-left hover:bg-surface-container-low ${FOCUS_RING}`;
/**
 * Choices behind the "+" button. Receipt scanning needs a configured AI vision provider; without it
 * the option stays disabled with an explanation (the app never pretends to read receipts).
 */
export function AddActionSheet({
  open,
  onClose,
  onChoose,
  aiConfigured = false,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (action: AddAction) => void;
  aiConfigured?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Thêm giao dịch" description="Chọn cách bạn muốn thêm.">
      <div className="flex flex-col gap-3">
        <button type="button" className={OPTION} onClick={() => onChoose("manual")}>
          <span className="text-label-lg text-on-surface">Thêm thủ công</span>
          <span className="text-body-sm text-on-surface-variant">Nhập từng khoản thu hoặc chi.</span>
        </button>
        <button type="button" className={OPTION} onClick={() => onChoose("csv")}>
          <span className="text-label-lg text-on-surface">Nhập CSV</span>
          <span className="text-body-sm text-on-surface-variant">
            Xem trước và chọn dòng cần nhập. Chưa lưu gì cho đến khi bạn xác nhận.
          </span>
        </button>
        {aiConfigured ? (
          <button type="button" className={OPTION} onClick={() => onChoose("receipt")}>
            <span className="text-label-lg text-on-surface">Quét biên lai</span>
            <span className="text-body-sm text-on-surface-variant">
              AI đọc ảnh và gợi ý cửa hàng, ngày, tổng tiền. Bạn kiểm tra và tự lưu.
            </span>
          </button>
        ) : (
          <>
            <button type="button" disabled aria-describedby="scan-soon-note" className={`${OPTION} cursor-not-allowed opacity-60`}>
              <span className="text-label-lg text-on-surface">Quét biên lai (chưa khả dụng)</span>
            </button>
            <p id="scan-soon-note" className="text-body-sm text-on-surface-variant">
              Quét biên lai cần trợ lý AI đọc ảnh, hiện chưa được cấu hình. Ứng dụng không tạo kết quả giả; bạn vẫn có
              thể thêm thủ công hoặc nhập CSV.
            </p>
          </>
        )}
        <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
          Đóng
        </button>
      </div>
    </Dialog>
  );
}
