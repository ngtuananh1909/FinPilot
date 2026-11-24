"use client";

export function ErrorState({
  title = "Đã có lỗi xảy ra",
  message = "Vui lòng thử lại. Nếu lỗi tiếp diễn, hãy quay lại sau.",
  onRetry,
  retryLabel = "Thử lại",
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="rounded-2xl border border-error/40 bg-surface-container-lowest p-6 text-center">
      <h2 className="text-lg font-semibold text-error">{title}</h2>
      <p className="mt-2 text-sm text-on-surface-variant">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
