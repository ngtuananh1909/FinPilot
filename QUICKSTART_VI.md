# Bắt đầu với FinPilot AI MVP (hướng dẫn ngắn)

## Bạn đang có gì?
Đây là **bộ đặc tả và prompt**, **chưa có code ứng dụng chạy được**. Nó gồm PRD, yêu cầu 5 page, thiết kế kiến trúc, SQL migration **chưa chạy**, mock-data để seed, Kiro steering/specs/tasks, prompt Stitch và Kiro.

## Thứ tự sử dụng khuyến nghị
1. Sao lưu các file trùng tên trong repository nếu project đã có sẵn. Giải nén ZIP **vào thư mục gốc của project** (để `.kiro/`, `docs/`, `prompts/` nằm ở root).
2. Copy nội dung `prompts/STITCH_MASTER_PROMPT.md` vào Google Stitch. Cho Stitch tự thiết kế visual theo các page và vị trí nút, không bắt Stitch theo pixel cố định.
3. Tải xuất ZIP thiết kế từ Stitch; giải nén vào `design/stitch/exports/v1/`. Kiểm tra có `DESIGN.md`, các screen và asset nếu Stitch xuất được.
4. Mở project bằng **Kiro IDE**. Bật **Model Auto** theo quyền truy cập của bạn, sau đó copy `prompts/KIRO_BOOTSTRAP_PROMPT.md` vào chat.
5. Kiro **chỉ đọc và lập kế hoạch** lúc đầu. Bạn duyệt G1 trước khi cho code. Kiro có thể triển khai UI, logic, test bằng dữ liệu mẫu offline sau khi G1 được duyệt.
6. Tạo `.env.local` từ `.env.example` và **tự điền** Supabase URL/key, Gemini hoặc OpenRouter API base URL/key/model. Không gửi secret vào chat, không commit `.env.local`.
7. Khi đến bước tạo bảng/seed vào **một Supabase project chung**, Kiro phải đưa cụ thể migration/seed và xin bạn duyệt G2. Không bao giờ tự `supabase db reset --remote`.
8. Khi các test đã ổn, Kiro trình báo cáo và xin duyệt G4 trước `git push`. Nếu bạn duyệt push lên `main`, AWS Amplify sẽ tự build/deploy.
9. Sau deploy, thử Guest Demo, 3 login mẫu, thao tác AI thật và Simulator bằng đường link công khai.

## Hai điều quan trọng
- **Chỉ một database** Supabase cho cả local và BGK. Bộ CSV/JSON chỉ làm dữ liệu **đầu vào seed**, không phải DB thứ hai.
- Đã duyệt **tài liệu/đặc tả sản phẩm**, nhưng **chưa duyệt chạy migration, tạo demo account thật, push hay deploy**.
