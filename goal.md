# WebGIS 認可 × 形式手法 実験プロジェクト 引き継ぎメモ

最終更新: 2026-11-19

## 0. 指針(経典)

このプロジェクトは、Lauren Tan(poteto)の講演 "All Code Is Slop Except Mine" と
pstack の考え方に従って進める。迷ったらこの章に戻る。

### 0.1 逆さの信頼ピラミッド

エージェントが人間の読める速さを超えてコードを書く以上、品質は1行ずつのレビューではなく、
**間違いを起こせない仕組みと検証にかけた労力**で決まる。仕組みは効く順に4層ある。

| 層 | 内容 | このプロジェクトでの例 |
|---|---|---|
| 1. 設計(最も広く安い) | 間違った選択肢そのものをなくす | PostGISのRLS、scopedDb、branded type |
| 2. 静的解析 | lint・型・テストで、まだ選べる間違いを捕まえる | import制限、フラグ禁止、依存方向 |
| 3. 実行時・形式検証 | 重要な性質が成り立つか、要求どおりか | モデル検査、TLA+、性質ベーステスト、UIの性質テスト |
| 4. 文章(最も狭く高い) | 判断が必要なものだけを書く。先端に人間のレビュー | CLAUDE.md、スキル |

ルールを足すときは、**できるだけ上の層で**実現する。文章で書いたルールは、
機械でチェックできるならlintやテストに移す。

### 0.2 守ること

- **コードベースはエージェントへの入力である。** エージェントは既存コードを手本にする。悪い例・回避策・非推奨のコードは残さず消す
- **コメントではなくlintのエラーメッセージで教える。** 指示は違反した瞬間に出す。コメントは古くなる
- **レビューで2回指摘したことはチェックにする。** 同じ指摘を繰り返さない
- **動いた証拠を出す。** 「動きました」には、スクリーンショット・テスト結果・反例の再現などの実物を添える。「判断できなかった」は合格ではない
- **主張には根拠の種類を付ける。** 測定した / 推測した / 当て推量、を区別する
- **自動化の順番を守る。** lintルールを足す → 古い悪い例を片付ける → 検証の手段を用意する → それからエージェントに量を書かせる
- **最小の変更で解く。** 必要以上に作らない

## 1. 目的

認証認可のある小さなWebGISアプリで、次を確かめる。

1. ピラミッドの各層が、どの種類のバグを、どの段階で捕まえるか
2. モデル検査で見つけた反例が、実装でも本当に再現するか
3. **土台(1〜3層)を作ったあとで、エージェントに機能を大量に足させても認可の漏れが入らないか**。土台がない場合と比べる

## 2. 前提知識の要約

| 手法 | やること | 言えること |
|---|---|---|
| unionの型 | ありえる状態(と組み合わせ)だけを型にする | ありえない状態は作れない |
| 状態機械 | 状態+イベント+遷移表で振る舞いを書く | 振る舞いの全体像、経路の列挙 |
| モデル検査 | 初期状態から全遷移をたどり、性質を全状態で確かめる | 書いた性質がモデルの全経路で成り立つ |
| 性質ベーステスト | ランダムな入力で性質を大量に試す | 実装が多数の入力で性質を満たす(証明ではない) |
| E2E | 実物をブラウザで動かす | 試した操作では実物が動く |

注意:
- モデル検査が確かめるのは設計(モデル)。実装とのずれはテストで埋める
- 性質を書き忘れたら、それに関するバグは見つからない
- モデルは「バグが出る最小規模」(ユーザー2〜3人、数ステップ)に絞る

## 3. 構成

| 層 | 採用技術 | 備考 |
|---|---|---|
| フロント | SvelteKit + MapLibre GL JS | 編集UIは状態機械 |
| 認証 | Better Auth | セッションはDB保存。ロールはadminまたはorganizationプラグイン |
| DB | PostgreSQL + PostGIS | RLSで認可を強制する |
| ベクタータイル | PostGISの `ST_AsMVT` など | 認可のかかった出口として扱う |
| テスト | Vitest + fast-check、Playwright、UIの性質ベーステスト(Bombadil等) | |
| モデル検査 | 自作の検査器(付録A)→ TLA+ | |
| 静的解析 | ESLint(カスタムルール含む)、dependency-cruiser、TypeScript strict | |
| エージェント | Claude Code + pstack-claude(pstackのClaude Code移植版) | |

### 3.1 ユーザーとロール

| ユーザー | ロール | 権限 |
|---|---|---|
| admin | 管理者 | 全地物の閲覧・編集、ロール変更 |
| a-staff | A市職員 | A市の地物の閲覧・編集 |
| b-staff | B市職員 | B市の地物の閲覧・編集 |
| viewer | 閲覧者 | 公開地物の閲覧のみ。非公開属性(`owner_name`)は見えない |

### 3.2 データ

- A市・B市にまたがる地物(点・ポリゴン)を数十件
- 属性: `city`、`public`、`owner_name`(非公開)、`version`(楽観的ロック)
- 市境付近・市境をまたぐ地物も入れる

### 3.3 データの出口

1. 地物一覧API
2. 範囲検索API(bbox)
3. ベクタータイル `/tiles/{z}/{x}/{y}`
4. (任意)エクスポート、低ズーム用の集約データ

## 4. 守るべき性質(先に書く)

### 安全性
- **P1 地域分離**: B市職員は、どの出口からもA市の地物を受け取らない(逆も同様)
- **P2 属性秘匿**: 閲覧者には、どの出口からも `owner_name` が届かない(タイルの属性も含む)
- **P3 剥奪後の書き込み禁止**: 編集権限を剥奪された後に送られた保存は失敗する
- **P4 ロストアップデートなし**: 二人とも保存を完了したら、両者の編集が残っている
- **P5 キャッシュ分離**: あるユーザー向けのタイルが、別の権限のユーザーに配信されない
- **P6 UIの排他**: どんな操作列でも、保存中に新しい描画は始まらない

### 活性
- **L1** 保存中は、いつか必ず成功か失敗で終わる(タイムアウトがある)

### 性質とピラミッドの対応

| 性質 | 1. 設計 | 2. 静的解析 | 3. 検証 |
|---|---|---|---|
| P1 | RLS、scopedDb | DBのimport制限 | 出口ごとの性質ベーステスト |
| P2 | branded type `PublicFeature` | レスポンス型の制約 | 出口ごと(タイル含む)の性質ベーステスト |
| P3 | 保存時にDBの権限を確認 | — | モデル2、TLA+、E2E |
| P4 | `version` による楽観的ロック | — | モデル1、E2E |
| P5 | キャッシュキーに権限を含める/共有キャッシュ禁止 | — | 別ユーザーで同じタイルを取得 |
| P6 | unionの状態機械 | モード用の真偽値フラグ禁止 | `next` の性質テスト、UIの性質テスト |

## 5. Better Auth で注目すべき挙動

Cognitoのトークン(JWT)と同じ種類の問題が、Better Authでは **cookie cache** で起きる。

- `session.cookieCache` を有効にすると、セッション情報が署名付きCookieに `maxAge` 秒キャッシュされ、その間DBを見ない
- ドキュメント上、取り消したセッションでも他の端末では `maxAge` が切れるまで有効なままになりうる
- 対策: cookie cacheを無効にする、`maxAge` を短くする、重要な操作では `getSession` に `disableCookieCache: true` を渡す
- ロール変更がキャッシュにいつ反映されるかは未確認 → **実験で確かめる**
- JWTプラグインのJWTを別サービスが署名検証だけで受け入れる場合も、失効が遅れる

→ P3の反例の本命。モデルでは `serverRole`(DB)と `cachedRole`(Cookie/JWT)を別の状態として持つ。

API名は実装時に公式ドキュメントで確認する。

## 6. 進め方

自動化の順番(0.2)に従い、**土台 → 証拠の手段 → エージェントで拡張** の順に進める。

### Phase 0: 性質と機能マップ
- 4章の性質をテストのスタブとして置く(最初は全部失敗してよい)
- **機能マップ**を作る: 地図閲覧 / 描画 / 保存 / ロール変更 / タイル表示 など、ユーザーから見た機能の一覧。人間とエージェントの共通語彙にする(`docs/feature-map.md`)

### Phase 1: 設計で縛る(層1)
- PostGISのRLSで、ユーザーの市・公開フラグに応じて行を絞る。接続ごとにユーザー情報をセッション変数で渡す
- ルートハンドラには生の `db` を渡さず、`scopedDb(user)` だけを渡す
- 非公開属性を除去した地物を `PublicFeature`(branded type)にし、レスポンスはその型しか受け取らない
- 編集UIは unionの状態機械(付録B)

### Phase 2: 静的解析で縛る(層2)
- `no-restricted-imports`: DBモジュールは `$lib/server/authz` 以外からimport禁止。エラーメッセージに「scopedDbを使う。理由: P1」と書く
- モードを表す真偽値の `$state`(`isSaving` など)を禁止するカスタムルール
- `setTimeout` / `requestAnimationFrame` による場当たり的な修正を、許可した場所以外で禁止
- dependency-cruiser で、クライアントからサーバーのコードを参照できないようにする
- コメントは原則書かない。説明はlintのメッセージと型に置く
- この時点で古い書き方・回避策が残っていれば消す

### Phase 3: 検証の手段を用意する(層3)
- **モデル検査**: 付録Aの検査器で
  - モデル1: 同時編集(検証済み: 素朴な保存は反例あり、バージョン付きはOK)
  - モデル2: 権限剥奪。操作は「読み込む/編集する/保存する」「管理者が剥奪する」「キャッシュが更新される」。キャッシュで認可する設計では反例が出るはず、保存時にDBを確認する設計ではOKになるはず
- **TLA+**: モデル2を書き直し、自作検査器の結果と比べる。L1(活性)も検査する
- **性質ベーステスト**: ランダムなユーザー×bbox×出口で P1・P2・P5
- **UIの性質ベーステスト**: Bombadil等でランダムな操作列を編集UIに流し P6
- **E2E**: モデル2の反例手順を再現し、cookie cache有効/無効で比べる(P3)。二つのブラウザで同時編集(P4)

### Phase 4: 証拠を機械で出せるようにする
- **アプリ操作CLI**: `pnpm drive --role b-staff --scenario draw-and-save --screenshot` のように、ロールと操作を指定して実行し、スクリーンショットを保存する
- **状態図とスクリーンショットの照合**: 編集UIの状態図(ユーザー視点)を描き、各状態のスクリーンショットと並べてレビューする
- エージェントの完了報告には、テスト結果・スクリーンショット・反例の再現のいずれかを必ず添える

### Phase 5: エージェントで拡張する(本番の実験)
土台の上で、エージェント(pstack-claude)に機能を足させる。例:
- 新しい出口を追加(エクスポート、ヒートマップ用の集約、属性検索)
- 新しい属性・新しいロール(委託業者: 担当エリア内のみ登録可)
- organizationプラグインに移行し「異動」を扱う

測ること:
- 土台なし(Phase 1〜2を外したブランチ)と土台ありで、同じ指示を出したときに入る認可の漏れの数
- どの漏れを、どの層(設計 / lint / 検証 / レビュー)が止めたか

### Phase 6: 振り返りとルールの昇格
- レビューで2回以上指摘したことを洗い出し、lint・型・テストに昇格させる
- 文章(CLAUDE.md)に残っているルールのうち、機械化できるものを移す

| バグ | 止めた層 | 段階 | 他の層で止まったか | 昇格したチェック |
|---|---|---|---|---|
| (記入) | | | | |

## 7. 未決事項

- RLSにユーザー情報を渡す方法(トランザクションごとの `set_config` か、ロールの切り替えか)
- ロール管理: adminプラグインか、organizationプラグイン(A市・B市を組織にする)か
- タイル配信: SvelteKitのエンドポイントか、別のタイルサーバーか(別サーバーにするとJWT検証の問題も試せる)
- UIの性質ベーステストのツール選定(Bombadilの対応状況を確認)
- pstack-claude の導入と、どのプレイブック(Feature / Bug fix など)を使うか

---

## 付録A: 小さなモデル検査器(動作確認済み)

```js
// 全状態を幅優先で探索し、不変条件を確かめる。反例があれば手順を返す。
function check(init, steps, invariant) {
  const key = s => JSON.stringify(s);
  const seen = new Map([[key(init), null]]);
  const queue = [init];
  while (queue.length) {
    const s = queue.shift();
    if (!invariant(s)) {
      const trace = [];
      let k = key(s);
      while (k) { const p = seen.get(k); trace.unshift(p ? p.label : "初期状態"); k = p?.prev; }
      return { ok: false, trace, states: seen.size };
    }
    for (const [label, t] of steps(s)) {
      const k = key(t);
      if (!seen.has(k)) { seen.set(k, { prev: key(s), label }); queue.push(t); }
    }
  }
  return { ok: true, states: seen.size };
}

// モデル1: 二人の同時編集
const clients = ["A", "B"];
const init = { server: { edits: [], ver: 0 }, A: { pc: "待機" }, B: { pc: "待機" } };

function steps(useVersion) {
  return s => {
    const out = [];
    for (const c of clients) {
      const me = s[c];
      if (me.pc === "待機")
        out.push([`${c}が読み込む`, { ...s, [c]: { pc: "編集中", local: s.server.edits, ver: s.server.ver } }]);
      if (me.pc === "編集中")
        out.push([`${c}が編集する`, { ...s, [c]: { ...me, pc: "保存待ち", local: [...me.local, c] } }]);
      if (me.pc === "保存待ち") {
        if (!useVersion || me.ver === s.server.ver)
          out.push([`${c}が保存する`, { ...s, server: { edits: me.local, ver: s.server.ver + 1 }, [c]: { pc: "完了" } }]);
        else
          out.push([`${c}の保存が競合で拒否され、読み直す`, { ...s, [c]: { pc: "待機" } }]);
      }
    }
    return out;
  };
}

// P4: 二人とも完了したら、両方の編集が残っている
const inv = s => !(s.A.pc === "完了" && s.B.pc === "完了") ||
  (s.server.edits.includes("A") && s.server.edits.includes("B"));

console.log("素朴な保存:", check(init, steps(false), inv));
console.log("バージョン付き:", check(init, steps(true), inv));
```

実行結果:

```
素朴な保存: ok: false, states: 23
  初期状態 → Aが読み込む → Aが編集する → Bが読み込む → Aが保存する → Bが編集する → Bが保存する
バージョン付き: ok: true, states: 21
```

## 付録B: 編集UIの状態機械(ライブラリなし版)

```ts
// src/lib/draw.ts
export type State =
  | { kind: "閲覧" }
  | { kind: "描画中"; points: [number, number][] }
  | { kind: "保存中"; points: [number, number][] };

export type Event =
  | { type: "描画開始" }
  | { type: "点追加"; point: [number, number] }
  | { type: "確定" }
  | { type: "取消" }
  | { type: "保存成功" }
  | { type: "保存失敗" };

export function next(s: State, e: Event): State {
  switch (s.kind) {
    case "閲覧":
      if (e.type === "描画開始") return { kind: "描画中", points: [] };
      return s;
    case "描画中":
      if (e.type === "点追加") return { ...s, points: [...s.points, e.point] };
      if (e.type === "確定" && s.points.length >= 3) return { kind: "保存中", points: s.points };
      if (e.type === "取消") return { kind: "閲覧" };
      return s;
    case "保存中":
      if (e.type === "保存成功") return { kind: "閲覧" };
      if (e.type === "保存失敗") return { kind: "描画中", points: s.points };
      return s;
  }
}
```

```svelte
<script lang="ts">
  import { next, type State, type Event } from "$lib/draw";
  let state: State = $state({ kind: "閲覧" });
  const send = (e: Event) => (state = next(state, e));
</script>

{#if state.kind === "閲覧"}
  <button onclick={() => send({ type: "描画開始" })}>描画</button>
{:else if state.kind === "描画中"}
  <p>{state.points.length} 点</p>
  <button onclick={() => send({ type: "確定" })}>確定</button>
  <button onclick={() => send({ type: "取消" })}>取消</button>
{:else}
  <p>保存中…</p>
{/if}
```

既知の課題: 「保存中」にタイムアウトのイベントがない(L1を満たさない)。Phase 1で追加する。

## 参考

- Lauren Tan, "All Code Is Slop Except Mine": https://ai.engineer/talks/O_zcc6Xl12g-all-code-is-slop-except-mine
- poteto-mode / pstack の解説: https://flaviocopes.com/poteto-mode/
- Better Auth Session Management: https://better-auth.com/docs/concepts/session-management
- fast-check: https://fast-check.dev/
- TLA+: https://lamport.azurewebsites.net/tla/tla.html
