// 実行ごとに別のタグ名を作る (ASCII のみ。Android の inputText は ASCII 以外を受けない)。
// DB に前回のタグが残っていても、追加が既存タグの再利用になったり rename が重複したりしない。
// 出力: output.tag / output.renamed
var ts = String(Date.now())
output.tag = "tg-" + ts
output.renamed = "tr-" + ts
