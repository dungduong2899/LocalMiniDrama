# Thiết kế: Hệ Rules & QC cho pipeline làm phim drama all-in-one

Ngày: 2026-07-18
Trạng thái: Chờ duyệt spec
Phạm vi: LocalMiniDrama (frontweb + backend-node)

## 1. Bối cảnh & vấn đề

Người dùng nhập cốt truyện → tool sinh kịch bản → storyboard → ảnh keyframe → video clip 5-15s → hợp thành 1 tập. Các vấn đề đã xác nhận (tất cả đang xảy ra):

- **P1** — Nhân vật/bối cảnh đổi diện mạo giữa các shot.
- **P2** — Video gen ra không đúng action/dialogue của storyboard.
- **P3** — Phân cảnh 1-2 phút bị nén/cắt vụn vào clip 15s, mất nhịp.
- **P4** — Góc máy giữa các clip liền kề nhảy lộn xộn, không theo ngôn ngữ dựng phim.
- **P5** — Phân tập không bám cốt truyện: 1 lần gọi LLM viết N tập, không kiểm soát mốc truyện rơi vào tập nào, không có bước duyệt.
- **P6** — Kịch bản thiếu hook: prompt hiện tại chỉ có 1 câu "kết thúc có suspense" chung chung.

Nguyên nhân gốc (người dùng chọn ưu tiên #1): **các bước prompt không có "hợp đồng" chung** — mỗi tầng tự diễn giải lại đầu ra của tầng trước.

## 2. Nguồn nghiên cứu đã chốt

### 2.1 Repo/hệ thống AI (đã đọc code trực tiếp)
- **ViMax (HKUDS, MIT, 11k★, rất active)** — không tích hợp làm engine (Python CLI/TUI, không HTTP API, chỉ xử lý kịch bản 1 cảnh, không TTS/duration control), nhưng **mượn 5 cơ chế**:
  1. *Camera registry + camera tree*: mỗi shot gán `cam_idx`, ưu tiên tái dùng vị trí máy; máy mới sinh từ máy cha (wide→medium→CU, cấm nhảy cóc), root = establishing shot.
  2. *Transition video*: mở góc máy mới bằng cách gen video chuyển máy từ frame máy cha, lấy frame cuối làm ảnh gốc góc mới, rồi thay element sai bằng portrait chuẩn ("giữ background, chỉ thay element sai").
  3. *variation_type per shot* (small/medium/large): small → i2v (1 ảnh đầu); medium/large → keyframes (ảnh đầu + cuối). Mode gen quyết định per-shot, không cố định toàn dự án.
  4. *Tách shot 3 phần*: first frame (snapshot tĩnh, cấm "sắp làm gì") / last frame (hệ quả logic) / motion (gọi nhân vật bằng **ngoại hình**, không dùng tên).
  5. *Best-of-N + vision judge*: gen nhiều ảnh, vision LLM chấm theo checklist 7 tiêu chí nhân vật + nhất quán không gian (A trái B phải không được đảo) + khớp mô tả.
- MovieAgent (ShowLab): học ý tưởng hierarchical planning (Director → Scene plan → Shot plan); code chết, không dùng.
- Open-AI-Micro-Drama-Generator: cùng bài toán nhưng non hơn LocalMiniDrama; không có gì để mượn.

### 2.2 Tri thức làm phim (13 DOC nội bộ + bổ sung)
13 file DOC (biên kịch, diễn xuất/FACS, đạo diễn/ngữ pháp shot, công thức drama, cảm xúc Hollywood, checklist, phim dài từ clip ngắn, kịch bản→prompt...) + bổ sung: **Series/Show Bible** chuẩn writers' room (StudioBinder/Industrial Scripts), **Pixar 22 Rules** (Emma Coats).

### 2.3 QC của các công ty lớn
- **Hollywood — Script Supervisor**: log continuity từng take (trang phục/đạo cụ/vị trí/hướng nhìn), lined script truy vết coverage kịch bản→shot, dailies review mỗi ngày (bắt lỗi khi còn quay lại được).
- **Netflix**: QC nhiều tầng theo giai đoạn (không dồn về cuối); Delivery Specifications = hợp đồng cứng; **máy lọc trước người duyệt sau** (ML dự đoán fail + pixel error detection, chỉ item nghi ngờ mới đến người).
- **ReelShort/DramaBox**: "character lock discipline" (nhân vật sống sót 80+ tập close-up, character sheet là spec bất khả xâm phạm); mọi quyết định chốt trước khi bấm máy; QC bằng dữ liệu retention người xem.

## 3. Thiết kế tổng thể

Nguyên tắc xuyên suốt: **mỗi tầng ký "hợp đồng" với tầng dưới; tầng dưới chỉ làm trong khuôn hợp đồng**. Tri thức chảy một chiều: DOC → Rule packs → prompt từng công đoạn → QC gates đối chiếu ngược lại rules.

```
Cốt truyện + Số tập + Phong cách/Thể loại
        ▼
[MỚI] Đề cương phân tập (Series Bible) ── người dùng duyệt/sửa ◄─ AI đề xuất lại nếu số tập không hợp
        ▼ chốt                                    [Gate 1]
Kịch bản từng tập (1 call/tập, theo đề cương + hook skeleton)
        ▼
Storyboard (scene contract + camera registry + variation_type per shot)
        ▼
Ảnh keyframe (anchor theo camera, best-of-N + vision check)  [Gate 2 — "dailies"]
        ▼
Video clip 5-15s (auto tail-frame chain trong cùng cảnh)
        ▼
[Gate 3 — delivery spec] ──► Hợp thành video = 1 tập trọn vẹn
```

### 3.1 Tầng Đề cương phân tập (Episode Outline / Series Bible)

Thay vì viết thẳng N tập trong 1 call, bước "Tạo kịch bản" trả về đề cương JSON:

```json
{
  "plot_points": [{"id": "P1", "text": "..."}, ...],
  "episode_count_suggestion": 4,
  "episode_count_reason": "...",
  "episodes": [{
    "episode": 1,
    "goal": "...",
    "plot_point_ids": ["P1", "P2"],
    "opening_hook": "hành động/xung đột diễn được trong 3-5s đầu",
    "cliffhanger": "câu hỏi bỏ lửng — cut on the question"
  }]
}
```

Rules của prompt đề cương:
- Mọi mốc truyện gán vào đúng 1 tập; không sót, không trùng.
- Được bịa chi tiết làm giàu (thoại, cảnh phụ); **cấm bịa biến cố** mâu thuẫn/thay thế mốc truyện.
- Số tập người dùng nhập không khớp dung lượng → điền `episode_count_suggestion` + lý do, UI cảnh báo.
- Mỗi 3-5 tập phải có 1 reveal đổi cục diện (rule micro-drama).

UI: bảng đề cương dưới ô "Tạo cốt truyện" — sửa text, kéo mốc truyện giữa các tập, nút "Chốt đề cương & viết kịch bản". Viết kịch bản: **mỗi tập 1 call riêng**, input = đề cương tập + tóm tắt tập trước. Sau khi viết: AI đối chiếu kịch bản với `plot_point_ids` — thiếu mốc → báo đỏ + nút "viết lại tập này" (Gate 1).

### 3.2 Rules Bible — chưng cất 13 DOC thành 6 rule packs

Lưu tại `backend-node/prompts/rulepacks/` (markdown/JSON, người đọc/sửa được, có version). `promptI18n.js` mở rộng: mỗi prompt template khai báo rule packs nó dùng, hệ thống tự ghép vào system prompt. Admin UI (PromptEditor sẵn có) thêm tab "Rules".

| Rule pack | Nguồn DOC | Tiêm vào | Rule ví dụ |
|---|---|---|---|
| `series-bible` | 01, 05, Show Bible | Đề cương phân tập | "Xung đột nằm sẵn trong premise"; "mỗi 3-5 tập 1 reveal" |
| `episode-script` | 01, 05, 06, Pixar 22 | Kịch bản tập | "Cấm thoại nói thẳng cảm xúc"; "mỗi thoại có action nhắm vào người kia"; "cấm trùng hợp cứu nhân vật"; skeleton Hook→Friction→Spike→Button |
| `shot-grammar` | 03, 10 | Storyboard | "Coverage wide→medium→CU"; "giữ trục 180°"; "1 shot = 1 hành động = 1 chuyển cảm xúc"; "ASL 4-6s" |
| `emotion-to-behavior` | 02 (FACS), 13, 06 | Prompt ảnh + video | Bảng dịch 10 cảm xúc → cụm hành vi (dạng **data**, tra bảng); cấm tên cảm xúc trong prompt |
| `continuity` | 10, 08 mục 8 | Prompt ảnh + video + nối cảnh | "CHARACTER/SETTING BLOCK copy nguyên văn mọi shot cùng cảnh"; "gọi nhân vật bằng ngoại hình trong motion" |
| `qc-gates` | 06, 07, 08, 10 | Gate 2 + Gate 3 | "Biểu cảm trước thoại + aftermath 0.5-1.5s"; "sau cao trào có pillow shot"; "reaction shot người nghe" |

### 3.3 Continuity engine (P1, P3, P4)

- **Sổ continuity per cảnh** (Script Supervisor ảo): bản ghi trạng thái — nhân vật mặc gì, đạo cụ ở đâu, ánh sáng, vị trí trái/phải, trục máy. Prompt ảnh/video của cảnh sinh từ bản ghi này, không để AI tự nhớ.
- **Lined script**: mỗi beat kịch bản map ≥1 shot; beat chưa có shot = lỗi coverage, chặn trước khi gen.
- **Camera registry**: storyboard gán `cam_idx` per shot theo rule ViMax (tái dùng vị trí máy; máy mới phải sinh từ máy cha gần cỡ cảnh).
- **variation_type per shot** → chọn i2v vs keyframes tự động (mode-aware: Kling Omni / Volcengine Seedance / Agnes / wan keyframes đều dùng được vì quyết định nằm ở tầng kế hoạch, không phụ thuộc provider).
- **Auto tail-frame chain**: nâng `tailFrameLinkService.js` từ thao tác tay per-shot → tự động trong cùng cảnh/camera: frame cuối clip trước thành mốc đầu clip sau, kèm rule 180°/match-cut/motion-direction trong prompt video.

### 3.4 Merge Pro — "Hợp thành video" như bàn dựng chuyên nghiệp

Hiện trạng: `videoMergeService.js` chỉ chạy `ffmpeg -f concat` (cắt cứng nối đuôi, không transition/audio/màu; fail thì lấy clip đầu làm kết quả).

Nguyên tắc (Murch, DOC 03/10): phim chuyên nghiệp dựng chủ yếu bằng **cắt cứng đúng nhịp**; transition hoa mỹ chỉ dùng khi đổi cảnh/đổi thời gian. "Chuyên nghiệp" = cắt đúng chỗ + âm thanh liền mạch + màu đồng nhất.

**(a) Nâng ffmpeg filtergraph** (không thêm dependency) + rule pack `editing` mới (chưng cất DOC 03/10):

| Kỹ thuật | ffmpeg | Rule |
|---|---|---|
| Dissolve/fade giữa cảnh | `xfade` | Chỉ giữa 2 phân cảnh khác nhau; trong cùng cảnh giữ hard cut |
| J/L-cut, audio mượt qua cut | `acrossfade`, `adelay`/`atrim` | Tiếng cảnh sau vào trước hình |
| Chất keo âm thanh | ambience + nhạc nền chạy xuyên các cut | Tai nghe liền mạch → mắt tin là liền mạch |
| Màu đồng nhất | `lut3d` áp LUT 1 lần khi merge | Xóa chênh màu giữa các lần gen |
| Loudness | `loudnorm` | Nghe rõ bằng loa điện thoại |

**(b) Xuất draft CapCut/剪映** để tinh chỉnh tay từng frame: tool tự xếp timeline + transition + phụ đề thành file draft; người dùng mở CapCut chỉnh rồi export. Ứng viên: pyJianYingDraft / pyCapCut (Python, đầy đủ nhất), capcut-cli (Node, zero-dep, đọc/ghi `draft_content.json` — hợp stack), capcut-mate (API service).

**(c) Giai đoạn sau (theo dõi, chưa tích hợp)**: AI editing agent — FireRed-OpenStoryline (3.1k★, Apache-2.0, intention-driven + Style Skills), HKUDS/VideoAgent (MIT, cùng lab ViMax). Học ý tưởng LLM chọn điểm cắt theo cảm xúc (Rule of Six).

Loại: FFCreator (ngừng phát triển 12/2024), Editly (bảo trì cầm chừng, xfade phủ được), Remotion (React render engine, quá cồng kềnh + license công ty).

### 3.5 Hệ QC 3 chốt (máy lọc trước, người duyệt sau)

| Gate | Khi nào | Kiểm gì | Cơ chế |
|---|---|---|---|
| 1 — Đề cương | Sau phân tập + sau viết kịch bản | Phủ đủ mốc truyện; hook/cliffhanger đạt format | Auto đối chiếu + người dùng duyệt đề cương |
| 2 — "Dailies" keyframe | Sau gen ảnh, trước gen video | Khớp character sheet + sổ continuity + layout; dàn keyframe kể được chuyện | Best-of-N + vision LLM chấm checklist; chỉ ảnh fail mới vào hàng đợi duyệt của người dùng |
| 3 — Delivery spec | Trước "Hợp thành video" | Đủ shot, tổng thời lượng khớp, thoại/audio đủ, không hụt beat | Auto checklist; fail → chặn merge kèm lý do |

Character lock (ReelShort): mọi CU/MCU phải pass đối chiếu mặt với character sheet trước khi dùng làm frame video.

(Tùy chọn giai đoạn sau: vòng lặp dữ liệu retention từ nền tảng phát hành về từng tập.)

## 4. Điểm chạm code chính

| Thành phần | File hiện có | Thay đổi |
|---|---|---|
| Đề cương phân tập | `storyGenerationService.js`, `promptI18n.js` | Thêm bước outline + per-episode call + Gate 1; API + bảng UI trong `FilmCreate.vue` |
| Rule packs | `promptI18n.js` (`_overrideCache`), `promptOverridesService.js` | Thư mục `prompts/rulepacks/`, cơ chế khai báo + ghép pack; tab Rules trong PromptEditor |
| Sổ continuity + camera registry | `storyboardService.js`, `framePromptService.js` | Schema thêm `cam_idx`, `variation_type`, scene state record |
| Auto tail-frame | `tailFrameLinkService.js` | Chuyển thành chain tự động theo cảnh/camera |
| Gate 2 | `imageService.js` / pipeline gen ảnh | Best-of-N + vision check + hàng đợi duyệt |
| Gate 3 | `videoMergeService.js` | Pre-merge checklist |
| Merge Pro | `videoMergeService.js`, `mergedEpisodePostProcess.js` | ffmpeg filtergraph (xfade/acrossfade/lut3d/loudnorm) + rule pack `editing`; nút xuất draft CapCut |

## 5. Lộ trình triển khai (mỗi đợt độc lập, thấy kết quả ngay)

1. **Đợt 1 — Rules + Phân tập**: 6 rule packs + tầng đề cương + Gate 1. (Giải P5, P6, nền của P2)
2. **Đợt 2 — Continuity**: sổ continuity + camera registry + auto tail-frame chain. (Giải P4, phần lớn P1, P3)
3. **Đợt 3 — QC gates**: Gate 2 best-of-N/vision + Gate 3 delivery spec + character lock. (Chốt P1, P2, tập trọn vẹn)
4. **Đợt 4 — Merge Pro**: ffmpeg filtergraph + rule pack `editing` + xuất draft CapCut. (Tập thành phẩm nghe/nhìn như phim dựng tay)
5. **Đợt 5 (tùy chọn)**: variation_type auto mode + transition video mở góc máy + vòng lặp dữ liệu retention + AI editing agent.

## 6. Ngoài phạm vi

- Không tích hợp ViMax/repo ngoài làm engine.
- Không train/fine-tune model; chỉ prompt + orchestration.
- Không thay đổi provider video hiện có; thiết kế mode-aware trên hạ tầng sẵn.

## 7. Rủi ro & đối sách

- **Chi phí tăng** (vision check, best-of-N, per-episode call): giới hạn best-of-N cho shot quan trọng (CU/cao trào); max 3 regen (kỷ luật DOC 11); Gate 2 chỉ chạy vision trên shot có mặt nhân vật.
- **Độ trễ pipeline dài hơn**: các gate chạy song song theo shot; người dùng chỉ bị chặn ở 2 điểm duyệt (đề cương, keyframe fail).
- **Rule packs phình to làm loãng prompt**: mỗi công đoạn chỉ nhận đúng pack của nó; pack viết dạng rule ngắn, không văn xuôi.
