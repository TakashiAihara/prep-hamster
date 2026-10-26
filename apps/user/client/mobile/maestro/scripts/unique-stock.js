// 実行ごとに別の barcode (EAN-13) と商品名を作る。barcode が毎回新規なので item は必ず新規になり、
// 他の flow や前回の実行が残した在庫と行が混ざらない。出力: output.barcode / output.name
var ts = String(Date.now())
var body = "49" + ts.slice(-10)
var sum = 0
for (var i = 0; i < 12; i++) {
  sum += Number(body.charAt(i)) * (i % 2 === 0 ? 1 : 3)
}
output.barcode = body + String((10 - (sum % 10)) % 10)
output.name = "mfl-" + PREFIX + "-" + ts
