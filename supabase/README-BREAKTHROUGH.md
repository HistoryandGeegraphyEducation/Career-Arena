# Triển khai chấm điểm tự động – Bứt Phá

## Thành phần đã thêm
- `supabase/migrations/202611150001_breakthrough_assessment.sql`: bảng lưu phòng đánh giá và từng phiên bản bài làm; RLS chặn truy cập trực tiếp từ anon/authenticated.
- `supabase/functions/_shared/breakthrough-rubrics.ts`: barem cố định cho 8 tình huống, tổng 100 điểm mỗi tình huống.
- `supabase/functions/breakthrough-assess/index.ts`: đăng ký phòng bằng mã bí mật, đồng bộ đội trưởng/tình huống, gọi AI, lưu phiên bản, trả phản hồi và cho giáo viên xác nhận điểm.
- Giao diện phòng chơi: thành viên đóng góp thẻ và ghi chú; đội trưởng tổng hợp thành câu trả lời chung; giáo viên xem tiêu chí, phản hồi và xác nhận điểm.

## Điều kiện cần cấu hình tại Supabase
Các tệp trên đã được đưa vào repository, nhưng GitHub Pages không thể tự chạy migration hoặc triển khai Edge Function. Cần thực hiện một lần tại dự án Supabase đang dùng:

1. Cài Supabase CLI và đăng nhập:
   ```sh
   supabase login
   supabase link --project-ref tlfuzdyblzlpogqlatkw
   ```
2. Áp dụng migration:
   ```sh
   supabase db push
   ```
3. Cấu hình khóa AI ở Secrets, không đưa khóa vào GitHub:
   ```sh
   supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_API_KEY
   supabase secrets set OPENAI_MODEL=gpt-4.1-mini
   ```
4. Triển khai Edge Function. Hàm tự xác thực bằng mã bí mật riêng của phòng; vì vậy triển khai không bật JWT mặc định:
   ```sh
   supabase functions deploy breakthrough-assess --no-verify-jwt
   ```

Supabase cung cấp `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` trong môi trường Edge Function. Không thêm service-role key vào website.

## Cách hoạt động
- Mỗi phòng có mã phòng và token xác thực riêng 256-bit. Token xác thực chỉ được giữ trong bộ nhớ trang giáo viên và không phát broadcast cho học sinh.
- Máy chủ lưu mã băm token, đội trưởng, tình huống đã phân và thời điểm kết thúc.
- Chỉ đội trưởng đã đồng bộ với máy chủ mới được gửi bài chung. Máy chủ kiểm tra đội trưởng, tình huống và thời hạn.
- Mỗi lần gửi tạo một phiên bản mới. Điểm đề xuất của phiên bản mới nhất là điểm hiện hành; không lấy trung bình.
- Điểm AI là điểm đề xuất. Giáo viên nhập/xác nhận điểm cuối; điểm được cộng vào bảng điểm Bứt Phá trong phiên phòng.
- Nếu thiếu `OPENAI_API_KEY`, AI không trả điểm giả. Bài được giữ ở phía giao diện để giáo viên biết việc đánh giá chưa sẵn sàng; cần gửi lại sau khi cấu hình.

## Giới hạn hiện tại
- Phiên phòng và bảng điểm trực tiếp vẫn vận hành theo kiến trúc realtime hiện có; dữ liệu bài làm/đánh giá được lưu bền vững trong Supabase.
- Việc đồng bộ trạng thái đội trưởng và tình huống lên Edge Function phụ thuộc máy giáo viên còn kết nối.
- Cần kiểm thử end-to-end sau khi migration và function được triển khai trên dự án Supabase thực tế.
