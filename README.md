# proof-lab

認証認可のある小さな WebGIS で、設計・静的解析・形式検証のどの層がどのバグを止めるかを確かめる実験。目的と進め方は [goal.md](goal.md)。

## 動かし方

Node 26(`.node-version`)、pnpm 12、Docker、Java(TLC 用)、Google Chrome(E2E・UI テスト用)が必要。

```sh
pnpm install
cp .env.example .env
pnpm db:up        # PostGIS を起動
pnpm db:reset     # スキーマ・RLS・シードを作り直す
pnpm dev          # http://localhost:5173 (同じページでデモユーザーを選んでログイン)
pnpm setup:tlc    # TLA+ のモデル検査器を取得(初回だけ)
pnpm test         # モデル検査 + 性質テスト + E2E(テスト用サーバーを 5199 番で自動起動)
pnpm test:ui 3m   # 本物の画面をランダムに操作して性質を確かめる(Bombadil。5197・5198 番を使う)
pnpm lint         # 静的解析(設計の縛り。ルールは eslint.config.ts)
```

## 文書

- [docs/feature-map.md](docs/feature-map.md): 機能と、関わる性質の対応
- [docs/model-checking.md](docs/model-checking.md): モデル検査の結果と、実装での再現

画面はログインから保存まで1つの状態機械(`src/lib/app/machine.ts`)。副作用を実行するのは `src/lib/app/effects.ts` だけ。
