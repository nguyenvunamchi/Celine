# SB SPACE HOLDING — Đặt phòng họp

Website đặt phòng họp cho dịch vụ văn phòng trọn gói: khách thuê tự đặt giờ theo
nguyên tắc **first in, first served**, được cảnh báo khi trùng lịch hoặc vượt
18 giờ họp miễn phí/tháng; ban quản trị đăng nhập riêng để sửa giờ họp và quản
lý danh sách công ty thuê.

## Kiến trúc

- **Backend:** Node.js + Express (`server/`), không phụ thuộc module native nào
  (không SQLite/Postgres) — dữ liệu lưu trong `data/store.json`, ghi theo kiểu
  atomic (ghi file tạm rồi rename) để không bao giờ hỏng file khi mất điện/crash
  giữa chừng. Phù hợp quy mô một văn phòng (vài công ty thuê, vài chục lượt đặt
  mỗi tháng); nếu sau này cần nhiều đồng thời hơn, chỉ cần thay `server/db.js`.
- **Đăng nhập admin:** một tài khoản duy nhất cấu hình qua `.env`
  (`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`), phiên đăng nhập là cookie đã ký
  (HMAC-SHA256) — không cần session store riêng, restart server không bị văng
  đăng nhập.
- **Frontend:** HTML/CSS/JS thuần (`public/`), không build step, gọi thẳng REST
  API (`/api/...`).
- **Khách thuê (customer):** *chưa có đăng nhập riêng* — chọn công ty của mình
  qua dropdown, giống mô hình "mọi người trong công ty dùng chung một vai trò".
  Xem mục "Giới hạn đã biết" bên dưới nếu cần nâng cấp lên đăng nhập từng công ty.

```
server/
  index.js            # Express app, static file serving, security headers
  db.js               # JSON file store (atomic read/write)
  lib/
    auth.js           # signed-cookie admin session
    booking-rules.js  # giờ mở cửa, kiểm tra trùng lịch (FCFS), tính giờ đã dùng/tháng
    rateLimit.js       # giới hạn số lần thử đăng nhập admin
  middleware/requireAdmin.js
  routes/
    public.js         # /api/rooms, /api/companies, /api/bookings...
    admin.js           # /api/admin/login, bookings & companies CRUD, /api/admin/stats
public/
  index.html, admin.html
  css/app.css
  js/app.js, js/admin.js
  fonts/*.woff2
scripts/hash-password.js
data/store.json        # tạo tự động khi chạy lần đầu (đã seed dữ liệu mẫu)
```

## Chạy thử ở máy local

```bash
npm install
cp .env.example .env
node scripts/hash-password.js "mat-khau-ban-chon"   # dán ADMIN_PASSWORD_HASH in ra vào .env
```

Mở `.env`, điền `ADMIN_USERNAME`, dán `ADMIN_PASSWORD_HASH` vừa tạo, và đặt
`SESSION_SECRET` (chuỗi ngẫu nhiên dài, ví dụ chạy
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

```bash
npm start
```

Mở `http://localhost:3000` (trang khách thuê) và `http://localhost:3000/admin.html`
(trang quản trị).

## Đưa code lên GitHub

Trên máy bạn (không phải trong phiên chat này — Claude không tự nhập mật khẩu/token
GitHub thay bạn):

1. Tạo một repo rỗng trên [github.com/new](https://github.com/new) (không tick
   "Add a README").
2. Chạy trong thư mục dự án:

```bash
git remote add origin https://github.com/<ten-ban>/<ten-repo>.git
git branch -M main
git push -u origin main
```

Nếu máy bạn chưa cấu hình Git credential, GitHub sẽ hỏi đăng nhập (dùng
Personal Access Token thay mật khẩu) ngay trong terminal — thao tác này riêng
tư giữa bạn và Git, không đi qua chat.

## Deploy lên Hostinger (VPS/Cloud có SSH)

### 1. Chuẩn bị VPS

SSH vào server, cài Node.js LTS và PM2 (giữ tiến trình chạy nền + tự khởi động
lại khi crash hoặc reboot):

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

### 2. Lấy code và cấu hình

```bash
git clone https://github.com/<ten-ban>/<ten-repo>.git atrium-booking
cd atrium-booking
npm install --omit=dev
cp .env.example .env
node scripts/hash-password.js "mat-khau-that-manh"
nano .env   # điền ADMIN_USERNAME, ADMIN_PASSWORD_HASH, SESSION_SECRET, đặt TRUST_HTTPS=true sau khi có SSL
```

### 3. Chạy bằng PM2

```bash
pm2 start server/index.js --name atrium-booking
pm2 save
pm2 startup   # copy lệnh nó in ra và chạy 1 lần để PM2 tự khởi động lại sau khi reboot VPS
```

### 4. Trỏ domain vào app qua Nginx (reverse proxy)

Cài Nginx nếu chưa có (`sudo apt-get install -y nginx`), tạo file cấu hình
`/etc/nginx/sites-available/atrium-booking`:

```nginx
server {
    listen 80;
    server_name booking.ten-mien-cua-ban.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/atrium-booking /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Bật HTTPS (khuyến nghị bắt buộc vì có trang đăng nhập)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d booking.ten-mien-cua-ban.com
```

Sau khi có HTTPS, mở `.env` đặt `TRUST_HTTPS=true` rồi `pm2 restart atrium-booking`
— nếu không, cookie đăng nhập admin sẽ không được gửi qua HTTPS và sẽ không thể
đăng nhập được.

### 6. Cập nhật code sau này

```bash
cd atrium-booking
git pull
npm install --omit=dev
pm2 restart atrium-booking
```

## Sao lưu dữ liệu

Toàn bộ dữ liệu nằm trong một file: `data/store.json`. Sao lưu định kỳ bằng
cron, ví dụ mỗi đêm:

```bash
0 2 * * * cp /home/<user>/atrium-booking/data/store.json /home/<user>/backups/store-$(date +\%F).json
```

## Giới hạn đã biết (nên cân nhắc nếu triển khai chính thức lâu dài)

- **Khách thuê chưa có đăng nhập riêng** — bất kỳ ai truy cập trang chủ đều có
  thể chọn "đặt với vai trò" bất kỳ công ty nào và đặt/huỷ lịch thay công ty đó.
  Phù hợp nếu chỉ chia sẻ link nội bộ trong toà nhà; nếu cần chặt chẽ hơn, thêm
  một bước đăng nhập theo công ty (mã PIN riêng từng công ty là cách đơn giản
  nhất để nâng cấp).
- **Một tài khoản admin duy nhất** — đủ cho một người quản lý; nếu có nhiều
  nhân viên lễ tân/quản trị cần theo dõi ai sửa gì, cần thêm bảng người dùng.
- **Lưu trữ bằng file JSON** — phù hợp quy mô nhỏ (một toà nhà, vài chục lượt
  đặt/tháng). Nếu mở rộng nhiều chi nhánh/lưu lượng cao, nên chuyển sang
  SQLite/Postgres.
