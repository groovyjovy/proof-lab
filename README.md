# proof-lab

認証認可のある小さな WebGIS で、設計・静的解析・形式検証のどの層がどのバグを止めるかを確かめる実験。目的と進め方は [goal.md](goal.md)。

## 動かし方

Node 26(`.node-version`)、pnpm 12、Docker、Java(TLC 用)、Google Chrome(E2E・UI テスト用)、Lean 4(証明用。`brew install elan-init` で入れると、`spec/lean-toolchain` の版が自動で入る)が必要。

```sh
pnpm install
cp .env.example .env
pnpm db:up        # PostGIS を起動
pnpm db:reset     # スキーマ・RLS・シードを作り直す
pnpm dev          # http://localhost:5173 (同じページでデモユーザーを選んでログイン)
pnpm setup:tlc    # TLA+ のモデル検査器を取得(初回だけ)
pnpm test         # Lean の証明 + 仕様との突き合わせ + モデル検査 + 性質テスト + E2E(テスト用サーバーを 5199 番で自動起動)
pnpm test:ui 3m   # 本物の画面をランダムに操作して性質を確かめる(Bombadil。5197・5198 番を使う)
pnpm drive --scenario tour --screenshot   # 画面の全状態を通ってスクリーンショットを撮る(5196 番を使う。evidence/ に出る)
pnpm lint         # 静的解析(設計の縛り。ルールは eslint.config.ts)
```

## 文書

- [docs/feature-map.md](docs/feature-map.md): 機能と、関わる性質の対応
- [docs/model-checking.md](docs/model-checking.md): モデル検査の結果と、実装での再現
- [docs/proofs.md](docs/proofs.md): Lean で証明した性質と、実装との突き合わせ
- [docs/screens.md](docs/screens.md): 画面の状態図と、`pnpm drive` のシナリオ

画面はログインから保存まで1つの状態機械(`src/lib/app/machine.ts`)で、仕様は `spec/Spec/App.lean`。画面は状態機械が差し出した操作(`src/lib/app/app.svelte.ts` の `actions`)しか持てない。副作用を実行するのは `src/lib/app/effects.ts` だけ。
