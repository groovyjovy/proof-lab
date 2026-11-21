# 事例研究で一緒に動かすもの

忘れると、どこかのテストが落ちるもの(落ちるテストを括弧に書いた)と、落ちないので忘れやすいもの(★)がある。★を先に見る。★の中で、数や一覧のように機械で確かめられるものは、確かめるテストを足して★を外す(goal.md 0.2)。

## 仕様と証明

- `spec/Axioms.lean` に、性質を表す新しい定理の `#print axioms` を足す
- `docs/proofs.md` の定理の表に、同じ定理を足す(`tests/conformance/axioms.test.ts` が、2つが同じかを見る)
- `tests/conformance/axioms.test.ts` の定理の数を直す
- ★ `docs/proofs.md` の「証明で見つかったこと」に、証明が要求したこと(通らなかった定理、書き出した前提)を書く
- `docs/proofs.md` の公理の節の定理の数(`axioms.test.ts`)。★内訳(画面 N・認可とサーバー M)は確かめていない

## 突き合わせとモデル3

- `tests/conformance/exhaustive.test.ts` の状態の数(テストが教える数に直す)
- `pnpm diagram` で `docs/screens.md` の状態図を作り直す(`model/state-diagram.test.ts`)
- `docs/proofs.md` の突き合わせの数(状態 × イベント = 通り。`exhaustive.test.ts` が文と突き合わせる。前の数は括弧に残す)
- `docs/model-checking.md` の結果の一覧の、モデル3の各範囲の状態数(`model3-app.test.ts`)。範囲を足したら、確かめる行も足す
- ★ `docs/model-checking.md` の範囲の節(環境、結果、壊した版の表、最短の反例)
- ★ 共有の型(`Me` など)を変えたら、モデル3と `exhaustive.test.ts` の利用者の一覧も直す
- ★ テストの中の判定(モデル3の `readable` など)が、崩した前提を使っていないか

## サーバー

- ★ マイグレーションを足したら、既存の DB には `pnpm db:reset` が要ることを報告に書く
- ★ 新しい出口(エンドポイント)は、本人の照合(`requireActor` の `as`、412)と、読める人にだけ返すこと(RLS)を性質テストで確かめる
- ★ 接続の途中で通知を失う余地があるなら、再接続で必要な状態を読み直せるか確かめる。P15 では、購読開始後の DB の本人と変更ごとの通知を性質テストで見て、画面への反映を E2E にした

## 前提に寄りかかっていたもの

- ★ 崩した前提を固定していた既存のテスト・シナリオ・文書を、変えた理由と一緒に報告に書く

## 画面

- ★ `scripts/drive.ts` にシナリオを足し、`docs/screens.md` のシナリオの表に足す
- ★ `docs/screens.md` に、画面がどう振る舞うかの節を足す
- ★ UI の探索(`tests/ui/`)の観測や性質、プロキシの障害を、新しい場面に合わせて足す

## goal.md と機能マップ

- ★ goal.md 4章: 性質(P 番号)と、ピラミッドの対応表の行
- ★ goal.md Phase 5: 事例研究の記録(崩した前提、証明が要求したこと、モデル3が見つけたこと、壊した版がどの層で赤になったか、破れなかった版)。「次の候補」から済んだものを外す
- ★ goal.md 7章: 決めたこと(採らなかった案と、その理由も)
- ★ `docs/feature-map.md` に機能の行(使えるロール、出口、関わる性質)
- ★ 進め方の決まりを変えたら、CLAUDE.md とこのスキルも直す(`AGENTS.md` と `.agents/skills/research-flow` はリンクなので、本体だけ直せばよい)

## 最後に

- `pnpm test`・`pnpm lint`・`pnpm check`・`pnpm build`
- ★ `pnpm explore 3m` の結果(破れた性質、届かなかった場面、探索で見えた機能の効果)を `docs/model-checking.md` に書く
- ★ tour(`pnpm drive --role admin --scenario tour --screenshot`)で、状態図の全状態に届くか
- commit(英語のメッセージ、末尾に attribution)と push
