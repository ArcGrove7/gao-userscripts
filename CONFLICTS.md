# 腳本拆分與衝突檢查報告

## 拆分結果

原本的 `gao-eyecare-classify-optimized.user.js`（v3.2.0）把兩個功能綁在同一支腳本中，
現已拆成兩支可各自獨立安裝的 Tampermonkey 腳本：

| 檔案 | 功能 | `@namespace` |
| --- | --- | --- |
| `gao-eyecare.user.js` | 護眼低飽和主題（WCAG AA） | `gunart-eyecare` |
| `gao-classify.user.js` | 裝備／素材／市場分類器 | `gunart-classify` |
| `gao-forge-history.user.js` | 鍛造歷史與期望值面板（本地側錄） | `gunart-forge` |

三者皆 `@match https://gunartonline.pages.dev/*`、`@grant none`、`@run-at document-start`，
可任意單裝或併用。`gao-forge-history.user.js` 額外採用 MIT 授權（`@license MIT`），
對應本專案根目錄新增的 `LICENSE`。

---

## 一、三支腳本之間會不會互相衝突？

**不會。** 三個模組各自在獨立的 IIFE 中，沒有共用任何變數作用域。
逐項核對它們對全域環境的接觸點，全部互不重疊：

| 接觸面 | 護眼主題 | 分類器 | 鍛造歷史 | 衝突？ |
| --- | --- | --- | --- | --- |
| `localStorage` key | `gao-lowsat-enabled` | `gao_cls_filters_v2` | `gao_forge_history_v1`、`gao_forge_ui_v1` | 否，key 皆不同 |
| `window` 旗標 | `__gaoEyeCareLoaded` | `__gaoClassifyLoaded`、`__gaoClsFetchHook` | `__gaoForgeLoaded`、`__gaoForgeFetchHook`、`__gaoForgeXhrHook` | 否，名稱不同 |
| CSS class / id | `gao-lowsat`（掛在 `<html>`） | `gao-cls-*`（自繪 UI） | `gao-fh-*`（自繪 UI） | 否，前綴不同 |
| DOM 屬性 | `data-gao-theme`、`data-gao-lowsat-*` | `data-gao-cls-*` | 無（僅用 id/class） | 否 |
| 熱鍵 | `Alt+1` / `Alt+2` | 無 | `Alt+3` | 否，鍵不同 |
| `window.history.pushState/replaceState` | 鏈式包裝 | 鏈式包裝 | 鏈式包裝 | 否，各自保留並呼叫前一個實作 |
| `window.fetch` | 未碰 | 包裝（`__gaoClsFetchHook` 防重入） | 包裝（`__gaoForgeFetchHook` 防重入） | 否，皆 `orig.apply` 原封回傳 |
| `XMLHttpRequest` | 未碰 | 未碰 | 包裝（`__gaoForgeXhrHook` 防重入） | 否 |

**鍛造歷史的側錄範圍：** 只被動側錄 `/api/forge/` 底下的**變更型**請求回應（明確排除
分類器所讀的唯讀清單 `/api/forge/equipment`），不送出任何額外請求、不修改請求或回應，
資料僅存於本機 `localStorage`。fetch 與 XHR 包裝皆為鏈式，永遠先呼叫原實作並原封回傳。

**CSS 變數依賴：** 分類器的自繪 UI 用到 `var(--q-legendary)`、`var(--bg-elevated)` 等變數，
這些是**遊戲原生**（或護眼主題）提供的。分類器每一處都寫了 fallback 值
（例如 `var(--bg-elevated,#20252e)`），所以**不裝護眼主題也能正常顯示**，兩者完全解耦。

---

## 二、會不會和你其他猴油腳本衝突？

整體風險**低**，兩支腳本的全域足跡都用 `gao` / `gunart` 前綴命名，隔離良好。
以下是唯二需要留意的「共享全域資源」，以及本次已做的加固：

### 1. 熱鍵 `Alt+1` / `Alt+2`（僅護眼主題）
- **用途：** `Alt+2` 開啟護眼主題、`Alt+1` 關閉。
- **風險：** 若你有其他腳本或遊戲本身也綁 `Alt+數字`，可能同時觸發。
- **加固：** 本次已加入判斷——當焦點在輸入框 / 文字區 / 下拉選單 / 可編輯元素時**略過**，
  且原本就**沒有 `preventDefault`**，因此不會吃掉事件、不會擋住其他腳本收到同一按鍵。
- **若仍衝突：** 直接改 `gao-eyecare.user.js` 底部 `keydown` 區塊的按鍵即可（主題另有下拉選單可切換，熱鍵非必要）。

### 2. `history.pushState` / `replaceState` 包裝（兩支都有）
- **用途：** 遊戲是 SPA，靠攔截路由變化來重新掛載 UI。
- **風險：** 多支腳本包裝同一個 API 是**常見且安全**的做法——每一層都會先呼叫上一層的實作
  （`original.apply`），行為會正確鏈接。唯一副作用是每次換頁多幾個 `setTimeout`，可忽略。

### 3. `window.fetch` 包裝（僅分類器）
- **用途：** 攔截 `/api/forge/equipment` 回應以取得裝備資料。
- **風險：** 若別的腳本也包裝 `fetch`，順序取決於載入先後，但分類器一律呼叫 `orig.apply(this, arguments)`
  並原封不動回傳 Promise，**不吞錯、不改參數、不改回應**，因此可與其他 fetch 攔截器共存。
- `__gaoClsFetchHook` 旗標可防止同一支腳本重複包裝。

### 4. 重複載入防護（本次新增）
- 兩支腳本開頭都加了 `if (window.__gaoEyeCareLoaded) return;` /
  `if (window.__gaoClassifyLoaded) return;`，即使不小心裝了兩份也不會重複執行、重複掛 observer。

---

## 結論

- 護眼主題已成功獨立為 `gao-eyecare.user.js`，可單獨安裝。
- 兩支腳本彼此**無衝突**，共用頁面時各自運作。
- 對外部（你其他猴油腳本）的風險項目只有 `Alt+1/2` 熱鍵，且已加輸入框防護、無 `preventDefault`；
  其餘全域包裝皆為安全的鏈式包裝。
