# tool-switch-claudes

Công cụ chạy trên Windows để dùng **nhiều tài khoản Claude Code trên cùng một máy** mà vẫn **dùng chung lịch sử phiên và memory**. Khi một tài khoản hết giới hạn, bạn mở lại đúng phiên đó bằng tài khoản khác.

- `kc.ps1` / `kc.cmd`: mỗi tài khoản là một hồ sơ (`a` = `~/.claude`, các hồ sơ khác = `~/.claude-<tên>`). Mỗi hồ sơ đăng nhập riêng; các thư mục `projects`, `agents`, `commands`, `skills` được nối (junction) về `~/.claude`.
- `ui/`: trang quản lý phiên chạy ở `http://127.0.0.1:4717`. Trang liệt kê mọi phiên, cho biết phiên nào đang chạy, phiên nào **hết giới hạn và giờ reset** (kèm thông báo Windows), và có nút mở tiếp ở terminal, chuyển phiên vào app desktop, Git, thư mục.
- `restart-app.ps1`: khởi động lại app Claude desktop sau khi chuyển phiên.

## Cài đặt

Cần Node.js 18+ và Claude Code (lệnh `claude`, hoặc bản đi kèm app desktop).

```bat
git clone https://github.com/NguyenHuyCao/tool-switch-claudes.git "%USERPROFILE%\claude-switch"
```

## Cách dùng

```bat
%USERPROFILE%\claude-switch\kc.cmd setup b           :: tạo hồ sơ b (1 lần)
%USERPROFILE%\claude-switch\kc.cmd login b           :: gõ /login, đăng nhập tài khoản thứ hai
%USERPROFILE%\claude-switch\kc.cmd ui                :: mở trang quản lý phiên
%USERPROFILE%\claude-switch\kc.cmd b --resume <id>   :: mở tiếp một phiên bằng tài khoản b
%USERPROFILE%\claude-switch\kc.cmd autostart on      :: tự bật trang quản lý khi đăng nhập Windows
```

Test phần nhận biết hết giới hạn: `node --test ui/limit.test.mjs`

## An toàn

- Server chỉ nghe ở `127.0.0.1`. Mọi thao tác có tác dụng phụ đều cần mã khoá riêng của máy (`ui/.token`, tự sinh, không đưa lên git).
- Không mở hoặc chuyển một phiên đang chạy, để hai nơi không ghi chồng lên một lịch sử.
- Tool không đọc, không chép, không chia sẻ mật khẩu hay token đăng nhập; mỗi tài khoản tự `/login`.
- Tool **không tự động đổi tài khoản** khi hết giới hạn, chỉ báo cho bạn. Điều khoản dùng Claude cho người dùng cá nhân (mục 3) cấm vượt qua các biện pháp bảo vệ của dịch vụ. Hãy tự đọc điều khoản trước khi dùng nhiều tài khoản.
