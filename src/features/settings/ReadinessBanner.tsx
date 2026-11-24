import type { ReadinessDto } from "@/lib/settings/dto";
import { readinessLines } from "./profile-form";
/** Shown while the forecast lacks inputs; each line links to the field to fill in. Renders nothing when complete. */
export function ReadinessBanner({ readiness }: { readiness: ReadinessDto }) {
  const lines = readinessLines(readiness);
  if (lines.length === 0) return null;
  return (
    <section
      role="status"
      aria-labelledby="readiness-title"
      className="rounded-card border border-warning/40 bg-warning-container p-4 text-on-warning-container"
    >
      <h2 id="readiness-title" className="text-title-md">
        Dự báo chưa đầy đủ
      </h2>
      <p className="mt-1 text-body-md">
        Một số thông tin còn thiếu hoặc đang bằng 0, nên dự báo chỉ hiển thị trạng thái chưa đủ dữ liệu thay vì con số
        đoán. Bổ sung các mục sau:
      </p>
      <ul className="mt-2 space-y-1">
        {lines.map((line) => (
          <li key={line.anchor}>
            <a href={`#${line.anchor}`} className="inline-flex min-h-[44px] items-center font-semibold underline">
              {line.text}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
