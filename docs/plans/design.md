# Linear Whiteboard - 設計書

## 1. プロジェクト概要

### コンセプト

デイリースクラムで使う「朝会用ビュー」。物理カンバンのようなホワイトボード風マトリクスビューをChrome拡張として提供する。

- **縦軸** = Issue（表示対象として選択されたissue）
- **横軸** = Status（チームのワークフローステータス）
- 各セルにissueに紐づく**subissue**を**付箋風カード**で表示
- 一覧性・俯瞰性を重視

### 対象ユーザー

デイリースクラムでLinearのタスク状況を確認するチームメンバー

---

## 2. ホワイトボードに表示する範囲

- **縦軸**: 表示対象のissue（設定画面でフィルタ条件を指定）
- **横軸**: チームのワークフローステータス（Linear APIから動的に取得）
- **セル内**: 各issueに紐づくsubissueを付箋風カードで表示

---

## 3. 技術構成

### 方式

**新しいタブで開く方式**を採用する。

理由:
- ホワイトボードビューは広い画面領域が必要（popupの800x600制限では不足）
- linear.appへのDOM注入はSPA更新で壊れやすい
- 独立ページなら開発・デバッグが容易

### 技術スタック

| 項目 | 選定 |
| --- | --- |
| 拡張形式 | Chrome Extension (Manifest V3) |
| 言語 | TypeScript |
| ビルド | Vite + @crxjs/vite-plugin |
| フレームワーク | なし（DOM操作はバニラTS） |
| CSS | プレーンCSS |
| API | Linear GraphQL API (`https://api.linear.app/graphql`) |
| 認証 | Linear Personal API Key |
| ストレージ | `chrome.storage.sync` |

**Vite + @crxjs/vite-plugin を採用する理由:**
- `manifest.json` からエントリポイントを自動解決（手動のビルドスクリプト不要）
- watchビルド対応で開発効率が高い
- ソースマップが有効でDevToolsからTSソースを直接デバッグ可能

### ファイル構成

```
linear-whiteboard/
├── src/
│   ├── popup/
│   │   ├── popup.html          # Popup UI
│   │   ├── popup.ts            # "Open Whiteboard" / "Settings" ボタン
│   │   └── popup.css
│   ├── whiteboard/
│   │   ├── whiteboard.html     # メインのホワイトボードページ
│   │   ├── whiteboard.ts       # マトリクスビューの描画ロジック
│   │   └── whiteboard.css      # 付箋風スタイル
│   ├── settings/
│   │   ├── settings.html       # API Key設定・チーム選択
│   │   ├── settings.ts
│   │   └── settings.css
│   └── lib/
│       ├── linear-api.ts       # Linear GraphQL APIクライアント
│       ├── storage.ts          # chrome.storage ラッパー
│       └── types.ts            # 型定義
├── public/
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── dist/                       # ビルド出力（gitignore対象）
├── manifest.json               # Manifest V3（@crxjs/vite-plugin が読み込む）
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── docs/
│   └── plans/
│       └── design.md
└── LICENSE
```

- `@crxjs/vite-plugin` が `manifest.json` を読み、HTML/TSのエントリポイントを自動解決
- HTML から `<script src="./popup.ts">` のようにTSを直接参照可能（Viteが変換）
- `public/` の内容は `dist/` にそのままコピーされる
- Chrome拡張として読み込むのは `dist/` ディレクトリ

### manifest.json

```json
{
  "manifest_version": 3,
  "name": "Linear Whiteboard",
  "version": "0.1.0",
  "description": "Daily Standup Whiteboard View for Linear",
  "permissions": ["storage"],
  "host_permissions": ["https://api.linear.app/*"],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- `@crxjs/vite-plugin` がこの manifest.json を読み、`src/popup/popup.html` 等のパスを解決する
- Service Worker（background script）はMVPでは不要
- `host_permissions` で Linear API への CORS を許可

### vite.config.ts

```ts
import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: "chrome114",
  },
});
```

---

## 4. データ設計

### 認証

- Linear Personal API Key を使用
- `Authorization: <api-key>` ヘッダーで送信（Bearerプレフィックスなし）
- API Keyは `chrome.storage.sync` に保存

### GraphQL クエリ

#### チーム一覧の取得（設定画面用）

```graphql
query Teams {
  teams {
    nodes {
      id
      name
    }
  }
}
```

#### ワークフローステータスの取得（横軸用）

```graphql
query WorkflowStates($teamId: String!) {
  team(id: $teamId) {
    states {
      nodes {
        id
        name
        type
        position
        color
      }
    }
  }
}
```

#### ホワイトボード用データ取得（Custom View 経由）

Linear の Custom View URL からビューIDを抽出し、そのビューに含まれるissueとsubissueを取得する。

URL例: `https://linear.app/anotherball/view/cycle-planning-backlog-30beca7f44e5`
→ ビューID: `30beca7f44e5`（末尾のハイフン区切りの最後のセグメント）

Custom View の `issues` フィールドを使うことで、ビューのフィルタ条件を手動で再構築する必要がない。

```graphql
query BoardData($viewId: String!) {
  customView(id: $viewId) {
    id
    name
    filterData
    issues(first: 50) {
      nodes {
        id
        identifier
        title
        priority
        state {
          id
          name
        }
        children {
          nodes {
            id
            identifier
            title
            priority
            assignee {
              id
              name
              avatarUrl
            }
            state {
              id
              name
              type
              color
            }
            labels {
              nodes {
                id
                name
                color
              }
            }
          }
        }
      }
    }
  }
}

### データ変換

APIレスポンスを以下のマトリクス構造に変換する:

```
{
  columns: [
    { id, name, color },  // ワークフローステータス（position順）
    ...
  ],
  rows: [
    {
      issue: { id, identifier, title },
      cells: {
        "<state_id>": [subissue, subissue, ...],
        ...
      }
    },
    ...
  ]
}
```

- 各issueの `children`（subissue）を `state.id` でカラムに振り分け

---

## 5. UI設計

### レイアウト

```
┌──────────────────────────────────────────────────────────────────┐
│ [Team]  View Name            Linear Whiteboard          [↻] [⚙] │
├──────────────────────────────────────────────────────────────────┤
│ [←]  Cycle 1                                  1 / 3        [→]  │  ← ページャー（グルーピング時のみ）
├───────────┬──────────┬──────────┬──────────┬──────────┬─────────┤
│           │   Todo   │ In Prog  │ In Review│ Ready QA │  Done   │
├───────────┼──────────┼──────────┼──────────┼──────────┼─────────┤
│ Issue A   │ ┌──┐┌──┐ │          │ ┌──┐     │          │ ┌──┐    │
│           │ │  ││  │ │          │ │  │     │          │ │  │    │
│           │ └──┘└──┘ │          │ └──┘     │          │ └──┘    │
├───────────┼──────────┼──────────┼──────────┼──────────┼─────────┤
│ Issue B   │          │ ┌──┐┌──┐ │          │ ┌──┐     │         │
│           │          │ │  ││  │ │          │ │  │     │         │
│           │          │ └──┘└──┘ │          │ └──┘     │         │
└───────────┴──────────┴──────────┴──────────┴──────────┴─────────┘

※ 各セルに付箋は横に2つ以上並ぶ（コンパクトサイズ）
※ Triage, Icebox, Canceled, Duplicated のレーンは非表示
```

### テーマ

- **Linearのダークテーマに準拠**: 背景 `#191A1F`、サーフェス `#1F2023`、ボーダー `#2E2F33`
- テキスト: Primary `#E2E2E3`、Secondary `#8B8C90`
- アクセント: `#5E6AD2`（Linearブランドカラー）

### CSS方針

- **CSS Grid** でマトリクスレイアウト
- ヘッダー行（Status列）: `position: sticky; top` で上部固定
- 左列（Issue名）: `position: sticky; left: 0` で左固定
- スクロール可能

### レーン表示ルール

- チームの workflow states を `position` 順で取得
- `type` が `triage`, `backlog`, `canceled` のもの、および名前が `Icebox`, `Canceled`, `Duplicated` 等のものは非表示

### グルーピング + ページャー

- Custom View のissueが Cycle でグルーピングされている場合、最初の Cycle のissueのみ表示
- ツールバー下部にページャーを表示（← Cycle名 1/3 →）
- 前後ボタンで他のグループに切り替え

### 付箋カードのデザイン

```
┌────────┐ 👤  ← assignee アバター（右上に重なる）
│ タイトル │
│ (省略)  │
└────────┘
```

- **コンパクトサイズ**: 1セルに最低2つ横並び（`width: calc(50% - 2px)`）
- タイトルのみ表示（2行で切り詰め）
- identifier は非表示
- **背景色**: 最初のラベルの色を薄く使用（ラベルで色分け）
- **左ボーダー**: Priority に応じた色（Urgent=赤, High=オレンジ, Medium=黄, Low=青, None=グレー）
- **Assigneeアバター**: 付箋の右上に重なるように配置（丸アイコン 20px）
- **ツールチップ**: マウスオーバーで identifier, フルタイトル, assignee, status, priority, labels を表示

### Popup（ツールバー）

Linear の Custom View ページを開いた状態で拡張アイコンをクリックすると:
- URL を自動検出し「Open Whiteboard」ボタンを表示
- クリックすると `whiteboard.html?viewUrl=...` でホワイトボードを新タブで開く
- Linear 以外のページでは案内メッセージを表示
- API Key 未設定時は Settings への導線を表示

### 設定画面

- API Key入力フィールド（password type + 表示切替）
- 「Verify & Save」ボタン → APIキーでteamsクエリを実行し検証
- 検証成功後: チーム選択ドロップダウンを表示
- 使い方の案内を表示

---

## 6. 開発環境・確認方法

### Chrome拡張のロード

1. `chrome://extensions/` を開く
2. 右上の「デベロッパー モード」を有効にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `dist/` ディレクトリ（ビルド出力先）を選択

### セットアップ・ビルド

```bash
npm create vite@latest . -- --template vanilla-ts   # 初回のみ（既存ファイルに上書き注意）
npm i -D @crxjs/vite-plugin @types/chrome concurrently
```

```bash
npm run dev          # 型チェック + Vite watchビルドを並行実行（開発時）
npm run build        # 型チェック + プロダクションビルド
```

package.json scripts:
```json
{
  "dev": "concurrently \"tsc --watch --noEmit\" \"vite build --watch\"",
  "build": "tsc --noEmit && vite build"
}
```

### コード変更時のリロード

- `npm run dev` を起動しておけば、ファイル保存時に自動で `dist/` が更新される
- **HTML/CSS/JS を変更した場合**: `chrome://extensions/` で拡張の更新ボタンをクリック、もしくはページをリロード
- **manifest.json を変更した場合**: 拡張の更新ボタンをクリックが必要

### デバッグ

- **Popup**: ツールバーのアイコンを右クリック →「ポップアップを検証」で DevTools が開く
- **Whiteboard / Settings ページ**: 通常のページと同じく F12 で DevTools
- **API通信の確認**: DevTools の Network タブで GraphQL リクエスト/レスポンスを確認
- **Storage の確認**: DevTools Console で `chrome.storage.sync.get(null, console.log)` を実行

### 動作確認チェックリスト（各Stepごと）

| Step | 確認項目 |
| --- | --- |
| Step 1 | 拡張がChromeにロードできる。Popupが開く。ボタンが表示される |
| Step 2 | API Keyを入力・保存できる。保存した値がリロード後も残る |
| Step 3 | API Keyでチーム一覧が取得できる。issueデータがコンソールに出力される |
| Step 4 | ホワイトボードページにマトリクスが表示される。付箋カードが正しいセルに配置される |
| Step 5 | ローディング表示が出る。APIエラー時にメッセージが出る。5分で自動更新される |

---

## 7. 実装ステップ

### Step 1: プロジェクト基盤

- Vite + TypeScript プロジェクト初期化（`npm create vite@latest`）
- `@crxjs/vite-plugin` / `@types/chrome` / `concurrently` インストール
- `manifest.json` / `vite.config.ts` / `tsconfig.json` / `.gitignore` 作成
- アイコン画像（仮のシンプルなもの）を `public/icons/` に配置
- `src/popup/popup.html` + `popup.ts` + `popup.css`（ボタン2つの簡単なUI）
- `npm run build` → `dist/` に出力 → Chrome拡張としてロードできることを確認

### Step 2: 設定画面 + ストレージ

- `src/lib/types.ts` — 型定義
- `src/lib/storage.ts` — chrome.storage.sync のラッパー
- `src/settings/settings.ts` + `static/settings/` 一式 — API Key入力・検証・保存
- API Key検証成功後にチーム選択

### Step 3: Linear APIクライアント

- `src/lib/linear-api.ts` — GraphQL APIクライアント
- チーム一覧取得クエリ
- ワークフローステータス取得クエリ
- issue + subissue取得クエリ
- 設定画面と結合

### Step 4: ホワイトボードビュー（コア機能）

- `static/whiteboard/whiteboard.html` — ページ骨組み
- `src/whiteboard/whiteboard.ts` — データ取得 → マトリクス構築 → DOM生成
- `static/whiteboard/whiteboard.css` — CSS Gridレイアウト + 付箋風スタイル

### Step 5: UX改善

- ローディング表示
- エラーハンドリング（API Key無効、ネットワークエラー）
- 空ステート表示
- 自動リフレッシュ（5分間隔）

---

## 8. 制約・考慮事項

| 項目 | 方針 |
| --- | --- |
| ページネーション | MVP では `first: 50`（issue）/ subissueはGraphQLのネストで取得。大規模チームでは要改善 |
| API Rate Limit | Linear API は 1500 req/hr。自動リフレッシュ5分間隔なら問題なし |
| セキュリティ | API Key は chrome.storage.sync に平文保存。ブラウザのストレージ暗号化に依存 |
| ダークモード | MVP では未対応 |
| ドラッグ&ドロップ | MVP では未対応（閲覧専用） |
| issueクリック | Linear の該当issueページを新タブで開く |
