# MyCra

ブラウザで遊べる Minecraft 風ボクセルワールドです。Three.js と Vite で作られており、GitHub Actions で GitHub Pages へ自動デプロイされます。

**公開 URL:** https://isamutakiguchi.github.io/mycra/

## 遊び方

| 操作 | キー |
| --- | --- |
| 移動 | `W` `A` `S` `D` |
| 視点 | マウス |
| ジャンプ | `Space` |
| ダッシュ | `Shift` (前進中) |
| ブロックを壊す | 左クリック |
| ブロックを置く | 右クリック |
| ブロック選択 | `1`〜`9` / マウスホイール |
| 飛行モード切替 | `F` (飛行中は `Space` で上昇、`Shift` または `Ctrl` で下降) |
| メニュー | `Esc` |

- 128×128×64 ブロックのワールドがパーリンノイズで生成されます (草原・山・砂浜・海・雪山・森)。
- 草・土・石・丸石・木材・原木・葉・ガラス・レンガの 9 種類を設置できます。岩盤は壊せません。
- 10 分で 1 日が経過する昼夜サイクルがあります。
- 変更したブロックとプレイヤー位置はブラウザの `localStorage` に自動セーブされます (10 秒ごと・メニューを開いたとき)。

## 開発

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ に出力
npm run preview  # ビルド結果を確認
```

## デプロイ

`.github/workflows/deploy.yml` が以下を自動で行います。

1. すべてのブランチ・Pull Request で `npm ci && npm run build` を実行してビルドを検証
2. `main` ブランチへの push 時のみ、`dist/` を GitHub Pages へデプロイ

初回は `actions/configure-pages` が Pages を自動で有効化します。もし失敗する場合は、リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定してください。

## 構成

```
index.html          画面・メニュー
src/main.js         起動、入力、HUD、セーブ、昼夜サイクル、メインループ
src/world.js        地形生成、チャンクのメッシュ化 (面カリング・AO)
src/blocks.js       ブロック定義、Canvas で生成するテクスチャアトラス
src/player.js       一人称カメラ、物理、当たり判定、水泳・飛行
src/raycast.js      視線が当たるブロックを求めるボクセル DDA
src/noise.js        シード付き乱数、2D パーリンノイズ
```
