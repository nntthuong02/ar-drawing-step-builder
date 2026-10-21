# AR Drawing Step Builder

Web tool tĩnh để biến ảnh line-art thành nhiều bước vẽ dùng chung một canvas.

## Chạy local

```bash
cd ar-drawing-step-tool
python3 -m http.server 8080
```

Mở `http://localhost:8080`.

## Quy trình

1. Tải PNG/JPG line-art hoặc mở ảnh mẫu.
2. Chỉnh ngưỡng nét đen và kích thước nhiễu tối thiểu.
3. Phân tích nét.
4. Chọn số bước và tự chia theo độ khó tăng dần. Step đầu có ít nét nhất; tăng số bước sẽ làm Step 1 đơn giản hơn.
5. Chọn một step, sau đó bấm vào nét trên canvas để chuyển nét vào step đó.
6. Xuất `master.svg`, `steps.json`, PNG tích lũy hoặc SVG riêng cho từng step.

Mỗi file `*-step-XX.svg` chỉ chứa các nét được gán cho đúng step đó. Tất cả file vẫn giữ nguyên kích thước và `viewBox` của ảnh nguồn để có thể chồng lại chính xác.

Khi xuất một file, trình duyệt tương thích sẽ mở hộp **Save As** để chọn tên và vị trí lưu. Khi xuất toàn bộ SVG/PNG, tool cho chọn một thư mục và ghi tất cả file vào đó. Trình duyệt không hỗ trợ File System Access API sẽ dùng thư mục Downloads mặc định.

Tất cả nhóm SVG sử dụng chung một `viewBox`, nên các step không thay đổi frame, tỉ lệ hay vị trí.
