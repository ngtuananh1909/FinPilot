"use client";

// Replaces the root layout, so it renders <html>/<body> and avoids relying on app CSS.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="vi">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#FCF8FF", color: "#1B1B24", margin: 0 }}>
        <main role="alert" style={{ maxWidth: 420, margin: "0 auto", padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>Đã có lỗi nghiêm trọng</h1>
          <p>Ứng dụng gặp sự cố. Vui lòng thử lại.</p>
          <button
            type="button"
            onClick={reset}
            style={{ minHeight: 44, minWidth: 44, padding: "0 20px", borderRadius: 12, border: 0, background: "#3525CD", color: "#fff", fontSize: 14 }}
          >
            Thử lại
          </button>
        </main>
      </body>
    </html>
  );
}
