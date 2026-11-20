# CLAUDE.md

目的と進め方は [goal.md](goal.md)、機能の一覧は [docs/feature-map.md](docs/feature-map.md)。

## 完了報告

「できました」「直しました」には、次のどれかを添える。添えられないなら、終わっていないと書く。

- テストの結果: どのコマンドで、何件通ったか(`pnpm test`、`pnpm test:ui 3m` など)
- スクリーンショット: `pnpm drive --role <ロール> --scenario <シナリオ> --screenshot` が書く `evidence/.../README.md`
- 反例の再現: わざと壊した版で、テストが赤になること
