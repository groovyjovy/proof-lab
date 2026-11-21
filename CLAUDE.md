# CLAUDE.md

目的と進め方は [goal.md](goal.md)、機能の一覧は [docs/feature-map.md](docs/feature-map.md)。
機能を足す・直すときの手順は、スキル [research-flow](.claude/skills/research-flow/SKILL.md) にまとめた(事例研究の流れ、わざと壊した版、見つけたものの扱い、記録の一覧、報告の形)。

このファイルは Claude Code と Codex で共用する(`AGENTS.md` はこのファイルへのリンク)。スキルの本体は `.claude/skills/research-flow/` に1つだけ置き、Codex は `.agents/skills/research-flow`(本体へのリンク)から読む。直すときは本体を直す。

## 完了報告

「できました」「直しました」には、次のどれかを添える。添えられないなら、終わっていないと書く。

- テストの結果: どのコマンドで、何件通ったか(`pnpm test`、`pnpm explore 3m` など)
- スクリーンショット: `pnpm drive --role <ロール> --scenario <シナリオ> --screenshot` が書く `evidence/.../README.md`
- 反例の再現: わざと壊した版で、テストが赤になること

## 乱数の探索で見つけたもの

`pnpm explore` は毎回の合否ではなく、フェーズの区切りに流す探索(goal.md の 2026-11-22 の決定)。
破れた性質を見つけたら、直す前に、決まった入力のテストにする。テストが赤になるのを確かめてから直す。

- 性質テスト(fast-check)なら、表示された種で同じ入力を流せる(`SEED=<種> pnpm test <ファイル>`)。落ちた入力を、決まった入力のテストとして残す
- 本物の画面(Bombadil)は再現できない。`evidence/explore/` の記録(トレース・スクリーンショット・プロキシの記録)を読み、決まった手順の E2E(`page.route` で通信を止める)にする
- モデルの前提の誤り(世界がモデルと違う振る舞いをした)なら、モデル(Lean の環境の応答・モデル3の環境)に取り込み、反例が出ることを確かめる
