# モデル検査の結果(Phase 3)

最終更新: 2026-11-19

goal.md の Phase 3 のうち、アプリなしで回せるモデル検査の結果をまとめる。
各主張には根拠の種類を付ける(【測定】= 実行して出力を見た、【推測】= モデルの結果から考えたこと)。

## 再現手順

```sh
pnpm setup:tlc   # tools/tla2tools.jar (TLA+ tools v1.7.4) を取得する。Java が必要(17.0.20 で確認)
pnpm test        # 自作検査器と TLC を両方回し、結論・反例・状態数を突き合わせる
```

`pnpm test` は次の 8 件を検査し、2026-11-19 にすべて通った【測定】。

```
✔ モデル1 素朴な保存: P4 の反例が付録Aと同じ手順・状態数で出る
✔ モデル1 バージョン付き: P4 が全21状態で成り立つ
✔ モデル2 cacheで認可: 剥奪後に送った保存がCookieのroleで受理される(P3の反例)
✔ モデル2 dbで認可: P3 が全18状態で成り立つ
✔ TLA+ Revocation cache: 自作検査器と同じ手順の反例、全状態数も一致
✔ TLA+ Revocation db: P3 が成り立ち、全状態数が自作検査器と一致
✔ TLA+ DrawUI タイムアウトなし: 応答が失われると保存中から抜けない(L1の反例)
✔ TLA+ DrawUI タイムアウトあり: L1 が成り立つ
```

## ファイル

| ファイル | 中身 |
|---|---|
| `model/check.ts` | 付録Aの検査器(幅優先、不変条件のみ) |
| `model/model1-concurrent-edit.ts` | モデル1: 同時編集(P4) |
| `model/model2-revocation.ts` | モデル2: 権限剥奪(P3) |
| `tla/Revocation.tla` + `Revocation_{cache,db}.cfg` | モデル2の TLA+ 版 |
| `tla/DrawUI.tla` + `DrawUI_{noTimeout,timeout}.cfg` | 付録Bの編集UI + 通信路(L1) |
| `model/models.test.ts` | 上の全部を回して突き合わせるテスト |

## 結果の一覧

| モデル | 性質 | 設計 | 結果 | 全状態数 |
|---|---|---|---|---|
| モデル1 | P4 | 素朴な保存 | 反例あり | 23 |
| モデル1 | P4 | バージョン付き | 成立 | 21 |
| モデル2 | P3 | Cookie cache の role で認可 | 反例あり | 20 |
| モデル2 | P3 | DB の role で認可 | 成立 | 18 |
| DrawUI | L1 | 付録Bのまま(タイムアウトなし) | 反例あり | 7 |
| DrawUI | L1 | タイムアウトあり | 成立 | 7 |

すべて【測定】。全状態数は、反例で止めずに最後まで探索した数(自作検査器は不変条件を外して、TLC は `-continue` で)。
反例で止まった時点の数は検査器によって違うので、ここには載せない(モデル2の節を参照)。

## モデル1: 付録Aの再現

TypeScript に移した検査器で、付録Aの結果(素朴な保存は 23 状態で反例、バージョン付きは 21 状態で成立)が、
反例の手順まで同じに再現した【測定】。検査器の移植が正しいことの確認として扱う。

## モデル2: 権限剥奪(P3)

### モデル

goal.md 5章のとおり、DB 上の role(`serverRole`)と Cookie cache 上の role(`cachedRole`)を別の状態として持つ。

- 登場するのは a-staff 1人と管理者だけ(バグが出る最小規模)
- a-staff: 読み込む → 編集する → 保存を送る → サーバーが受理 / 拒否(拒否されたら読み直す)
- 管理者: a-staff の編集権限を剥奪する(1回)
- Cookie cache: いつでも DB の値に追いつきうる(`maxAge` 切れの再取得を、いつ起きてもよいとして表す)
- 保存リクエストには、送った時点の Cookie の role と「剥奪の後に送ったか」(`afterRevoke`)を載せる
- P3 は「`afterRevoke` が真の保存が、一つもコミットされていない」という不変条件にした

設計の違いは、サーバーが保存を受理するときに見る role の出どころだけ(`cache` か `db` か)。

### 反例(cache で認可)

自作検査器の出力【測定】:

```
初期状態
→ a-staffが読み込む
→ a-staffが編集する
→ 管理者が剥奪する
→ a-staffが保存を送る(Cookieのrole=editor)
→ サーバーがcacheのrole=editorで保存を受理する
```

TLC の出力(抜粋)【測定】:

```
Error: Invariant P3 is violated.
State 1: <Initial predicate>
State 2: <Load ...>
State 3: <Edit ...>
State 4: <Revoke ...>     serverRole = "none", cachedRole = "editor"
State 5: <Send ...>       inflight = <<[cookieRole |-> "editor", afterRevoke |-> TRUE]>>
State 6: <Accept ...>     committed = <<TRUE>>
```

剥奪されたあとでも、Cookie cache が更新されるまでは保存が通る。goal.md の予想どおり。

### 自作検査器と TLC の突き合わせ

| | 自作検査器 | TLC | |
|---|---|---|---|
| cache: 反例の長さ | 6 状態 | 6 状態 | 一致。どちらも幅優先なので最短の反例 |
| cache: 反例の手順 | 読込→編集→剥奪→送信→受理 | Load→Edit→Revoke→Send→Accept | 一致 |
| cache: 全状態数 | 20(不変条件なしで全探索) | 20(`-continue`) | 一致 |
| db: 全状態数 | 18 | 18 | 一致 |

すべて【測定】。

反例を見つけて止まった時点の状態数は、自作検査器が 19、TLC が 16 で違う。
自作検査器はキューから取り出すときに、TLC は状態を生成したときに検査するので、止まる位置がずれる。
全状態数で比べると一致するので、二つは同じ状態空間を探索していると判断した。

### テストがずれを捕まえることの確認

複製したプロジェクトで TS 版だけを「常に DB で認可する」(`const role = s.serverRole;`)に書き換えると、
`モデル2 cacheで認可` と `TLA+ Revocation cache` の 2 件が失敗した【測定】。
TS 版と TLA+ 版の片方だけを変えると、テストが落ちる。
これは一度だけ手で回した確認で、`pnpm test` には含めていない。

## DrawUI: 保存中はいつか必ず終わる(L1)

### モデル

付録Bの `next` と同じ遷移に、保存リクエストの通信路を足した。点の座標は L1 に関係しないので、点の数(0〜3)だけを持つ。

- 通信路: 応答待ち(`inflight`)の応答は、成功・失敗のどちらかで返るか、失われる(`lost`)
- タイムアウト(定数 `HasTimeout` が真のときだけ): 保存中なら描画中に戻す。遅れて届く応答は捨てる

公平性の仮定(これがないと活性の結果に意味がない):

| 対象 | 仮定 | 理由 |
|---|---|---|
| サーバーの応答 | WF: 応答待ちが続くなら、いつか応答する | 応答が来ない場合は「失われた」で別に表している |
| タイマー | WF: 保存中が続くなら、いつか発火する | 実装ではタイマーが必ず発火する |
| ユーザーの操作 | 仮定しない | 何もしないこともありうる |
| 応答の喪失 | 仮定しない | 起きることも起きないこともある |

### 結果

タイムアウトなし(付録Bのまま)の TLC 出力【測定】:

```
Error: Temporal properties were violated.
State 1: <Initial predicate>  kind = "view"
State 2: <Start ...>          kind = "drawing"
State 3〜5: <AddPoint ...>    points = 1, 2, 3
State 6: <Commit ...>         kind = "saving", net = "inflight"
State 7: <Lose ...>           kind = "saving", net = "lost"
State 8: Stuttering
```

確定して保存中になったあと応答が失われると、そのまま保存中から抜けない。goal.md の付録Bに書いた既知の課題が、反例として出た。
タイムアウトありでは、7 状態すべてで L1 が成り立った【測定】。

### 合格が空虚でないことの確認

仮定を一つずつ外した変種でも回した【測定】。
`DrawUI.tla` を複製して書き換え、一度だけ手で回した確認で、`pnpm test` には含めていない。

| 変種 | 書き換え | 結果 | 分かること |
|---|---|---|---|
| WF(Timeout) を外す | `Spec` から `/\ WF_vars(Timeout)` を消し、`DrawUI_timeout.cfg` で回す | 反例あり(Commit → Lose → Stuttering) | 合格は「タイマーが実際に発火する」ことに支えられている |
| 応答の喪失をなくす | `Next` から `\/ Lose` を消し、`DrawUI_noTimeout.cfg` で回す | 成立(6 状態) | 付録Bの版が破れる原因は応答の喪失 |

## 設計への示唆

### RLS に渡す role の出どころ【推測】

goal.md 7章の未決事項「RLS にユーザー情報を渡す方法(`set_config`)」に関わる。
`set_config` で渡す role を、Cookie cache を使った `getSession` から取ると、RLS は Cookie cache 上の role で認可する。
これはモデル2の `cache` と同じ構造なので、**RLS を入れても P3 は破れる**と考える。

P3 を守るには、保存の認可に使う role を DB から読む必要がある。候補は次のとおり。

- 保存のときだけ `getSession` に `disableCookieCache: true` を渡し、その結果を `set_config` に渡す
- RLS のポリシーで、`set_config` の role ではなくユーザーIDだけを使い、role はポリシー内で DB の表から引く

後者なら、確認と書き込みが同じトランザクションの中で起きる。
Better Auth の実際の挙動(ロール変更が Cookie cache にいつ反映されるか)は、まだ確かめていない。Phase 3 の E2E で確かめる。

### タイムアウトのあとに遅れて届く応答【推測】

DrawUI ではタイムアウトのあとに遅れて届く応答を「捨てる」とした。
実装では、タイムアウトして描画中に戻り、もう一度確定したあとに、前のリクエストへの応答が届きうる。
これを新しいリクエストへの応答と取り違えると、保存していないものを保存済みと表示する。
リクエストIDで応答を照合する設計が要りそうだ。今のモデルでは表していないので、次に足す候補にする。

## モデルの限界

- モデル検査が確かめたのは設計(モデル)であって、実装ではない。実装とのずれは、性質ベーステストと E2E で埋める
- モデル2は、ユーザー1人・剥奪1回・保存リクエスト1件まで。複数端末(端末ごとに別の Cookie cache)や、権限の再付与は入れていない
- Cookie cache の更新は「いつ起きてもよい」としている。`maxAge` の具体的な秒数は扱っていない
- P3 は goal.md の定義どおり「剥奪の後に送られた保存」だけを対象にしている。剥奪の前に送られ、剥奪の後に処理された保存は、どちらの設計でも P3 違反にならない

## 用語の対応

TLA+ の識別子は ASCII にしたので、対応を書いておく。

| TLA+ | 意味 |
|---|---|
| `Load` / `Edit` / `Send` | 読み込む / 編集する / 保存を送る |
| `Accept` / `Reject` | サーバーが保存を受理する / 拒否する |
| `Revoke` / `RefreshCache` | 管理者が剥奪する / Cookie cache が DB に追いつく |
| `view` / `drawing` / `saving` | 閲覧 / 描画中 / 保存中 |
| `Start` / `AddPoint` / `Commit` / `Cancel` | 描画開始 / 点追加 / 確定 / 取消 |
| `Succeed` / `Fail` / `Lose` / `Timeout` | 保存成功 / 保存失敗 / 応答が失われる / タイムアウト |
