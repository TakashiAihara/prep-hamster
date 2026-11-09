// 実行ごとに別の barcode (EAN-13) と商品名を作る。barcode が毎回新規なので item は必ず新規になり、
// 他の flow や前回の実行が残した在庫と行が混ざらない。出力: output.barcode / output.name
var ts = String(Date.now())
// 20 は GS1 が店内専用 (restricted circulation) に取ってある接頭辞で、商品には振られない。
// 49 (国内の商品) だと外部の JAN lookup に当たって商品名が固定され、subflow が名前を入れられず落ちる
var body = "20" + ts.slice(-10)
var sum = 0
for (var i = 0; i < 12; i++) {
  sum += Number(body.charAt(i)) * (i % 2 === 0 ? 1 : 3)
}
output.barcode = body + String((10 - (sum % 10)) % 10)
output.name = "mfl-" + PREFIX + "-" + ts
