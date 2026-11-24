# Slide deck outline (≤ 10 slides, PDF, freeze after submission)

1. **Vấn đề**: dòng tiền ngắn hạn khó đoán với sinh viên và người mới đi làm; quyết định mua sắm thiếu dữ liệu.
2. **Người dùng**: 3 persona mẫu (sinh viên, người mới đi làm, dòng tiền cần chú ý) và câu hỏi chính của họ.
3. **Giải pháp**: 5 trang, mobile-first; trải nghiệm khách không cần đăng ký.
4. **Động cơ tính toán**: số dư theo mốc, 45 ngày theo giờ Việt Nam, khoản định kỳ, không tính trùng; AI không tự tính tiền.
5. **Mô phỏng mua ngay / mua sau**: "an toàn" chỉ khi mọi ngày ≥ 0 và ≥ mức dự phòng (ví dụ ảnh chụp thật).
6. **Trợ lý AI**: gọi công cụ thật, nêu nguồn số liệu, chỉ đề xuất ngân sách/mục tiêu và chờ người dùng xác nhận.
7. **Nhập liệu**: CSV có xem trước và kiểm tra trùng; quét biên lai tạo bản nháp có thể sửa.
8. **An toàn & riêng tư**: một cơ sở dữ liệu, RLS theo chủ sở hữu, hạn mức 20/5 mỗi ngày, khóa bí mật chỉ ở máy chủ.
9. **Kiểm thử**: số bài test thực tế (unit/route/RLS live/E2E) lấy từ `docs/evidence/ac-matrix.md` tại thời điểm nộp; không nêu số liệu chưa đo.
10. **Demo & liên kết**: URL, cách đăng nhập, công nghệ (Next.js 15, Supabase, AWS Amplify, Gemini/OpenRouter).
